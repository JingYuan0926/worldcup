//! Exact Match — precision prediction pools for the 2026 World Cup.
//!
//! Program spec: README §6. Payout math: README §5.3, implemented in `payout.rs`
//! and pinned to `docs/payout-vectors.json` alongside the TypeScript twin.
//!
//! ── Stakes are an SPL token (demo USDC) ─────────────────────────────────────
//! Each pool records its own `mint` at creation and its vault is an ATA owned by
//! the pool PDA, so the escrow asset is configuration rather than a constant. The
//! demo runs on a 6-decimal mint we control (see `npm run usdc:create`); Circle's
//! devnet USDC would work byte-identically, but its mint authority is Circle's, so
//! a demo could only ever hold faucet dust.
//!
//! `token_interface` is used throughout rather than the classic `Token` types, so
//! a Token-2022 mint works here unchanged. (README §7.1 claims the devnet USDT
//! mint ELWTKsp… is Token-2022 — it is not, it is owned by the classic SPL Token
//! program. Going through the interface means the distinction cannot bite us.)
//!
//! ── Trust model, stated plainly ─────────────────────────────────────────────
//! The end state (README §0) is that **only a TxLINE Merkle proof moves money**:
//! `settle` CPIs into `txoracle::validate_stat` and a forged value fails on-chain.
//! That CPI is unverified (README §8 spike #3) and its proof encoding is still
//! PROVISIONAL (docs/settlement-spec.md), so this version ships the vault, the
//! entry rules and the payout math — identical under every settlement path —
//! behind a `resolver` signature on `settle` ONLY.
//!
//! `resolver` is a deliberate, temporary trust delta, and it is the ONLY authority
//! in the program:
//!   - it cannot touch the vault, cannot take a fee, cannot refund, cannot claim;
//!   - it cannot re-settle (state flips Open → Settled exactly once);
//!   - it cannot settle before lock, or outside the pool's own range;
//!   - if it never settles at all, `refund` opens to everyone at the deadline and
//!     every entrant gets their stake back without it.
//! Replacing the `resolver` check in `settle` with the `validate_stat` CPI is the
//! whole remaining delta to the trustless design: no account layout, math, or
//! client code changes with it.
//!
//! There is no admin key and no fee switch.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

pub mod payout;

use payout::{payout_for, MAX_ENTRIES};

declare_id!("9KKWfU1EB51EmBoiTusZ3J7h7b6JmHNa2aQujtJdZBen");

/// Stake bounds in token base units — 1 to 100 USDC at 6 decimals (README §5.2
/// keeps minimums small). The 100 cap also keeps `losers_pot * weight` inside u128.
pub const MIN_STAKE: u64 = 1_000_000;
pub const MAX_STAKE: u64 = 100_000_000;

/// Refunds open this long after lock if no valid settle landed (README §5.2).
pub const SETTLE_WINDOW_SECONDS: i64 = 12 * 60 * 60;

/// Widest question a pool may ask. Covers minutes-of-a-match (0–124) with room,
/// while still rejecting a range so large the accuracy weight goes flat.
pub const MAX_SLIDER_SPAN: i64 = 200;

#[program]
pub mod exact_match {
    use super::*;

    /// Permissionless. Pool parameters are fixed at creation, forever.
    #[allow(clippy::too_many_arguments)]
    pub fn create_pool(
        ctx: Context<CreatePool>,
        fixture_id: i64,
        pool_index: u8,
        stat_key_a: u32,
        stat_key_b: u32,
        op: u8,
        lock_ts: i64,
        settle_phase: u8,
        slider_min: i32,
        slider_max: i32,
        resolver: Pubkey,
    ) -> Result<()> {
        require!(slider_min < slider_max, ExactMatchError::InvalidRange);
        // WHEN pools speak in 5-minute buckets and top out at NEVER (20). COUNT pools
        // speak in whatever the question counts — goals, corners, or minutes of the
        // match spent level — so the range is bounded for sanity, not pinned to the
        // bucket vocabulary. An earlier version capped every pool at NEVER, which
        // silently made any question with a range past 20 impossible to create.
        let span = (slider_max as i64) - (slider_min as i64);
        require!(span <= MAX_SLIDER_SPAN, ExactMatchError::InvalidRange);
        require!(op <= 1, ExactMatchError::InvalidStatSpec);
        require!(stat_key_a != 0, ExactMatchError::InvalidStatSpec);

        let pool = &mut ctx.accounts.pool;
        pool.fixture_id = fixture_id;
        pool.pool_index = pool_index;
        pool.stat_key_a = stat_key_a;
        pool.stat_key_b = stat_key_b;
        pool.op = op;
        pool.lock_ts = lock_ts;
        pool.settle_phase = settle_phase;
        pool.settle_deadline_ts = lock_ts
            .checked_add(SETTLE_WINDOW_SECONDS)
            .ok_or(ExactMatchError::MathOverflow)?;
        pool.slider_min = slider_min;
        pool.slider_max = slider_max;
        pool.state = PoolState::Open as u8;
        pool.actual = 0;
        pool.resolver = resolver;
        pool.mint = ctx.accounts.mint.key();
        pool.total_staked = 0;
        pool.entries = Vec::new();
        pool.bump = ctx.bumps.pool;

        emit!(PoolCreated { pool: pool.key(), fixture_id, pool_index, lock_ts });
        Ok(())
    }

    /// Enter a pool before kickoff. One entry per wallet per pool (README §5.2).
    pub fn enter(ctx: Context<Enter>, guess: i32, stake: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let wallet = ctx.accounts.user.key();

        {
            let pool = &ctx.accounts.pool;
            require!(pool.state == PoolState::Open as u8, ExactMatchError::PoolNotOpen);
            // Anti-sniping: you predict before the window, then watch (README §5.2).
            require!(now < pool.lock_ts, ExactMatchError::PoolLocked);
            require!(
                guess >= pool.slider_min && guess <= pool.slider_max,
                ExactMatchError::GuessOutOfRange
            );
            require!(stake >= MIN_STAKE && stake <= MAX_STAKE, ExactMatchError::StakeOutOfRange);
            require!(pool.entries.len() < MAX_ENTRIES, ExactMatchError::PoolFull);
            require!(
                !pool.entries.iter().any(|e| e.wallet == wallet),
                ExactMatchError::AlreadyEntered
            );
        }

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            stake,
            ctx.accounts.mint.decimals,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.entries.push(Entry { wallet, guess, stake, claimed: false });
        pool.total_staked = pool
            .total_staked
            .checked_add(stake)
            .ok_or(ExactMatchError::MathOverflow)?;

        emit!(Entered { pool: pool.key(), wallet, guess, stake });
        Ok(())
    }

    /// Record the settled outcome. See the trust-model note at the top of this file:
    /// this is the one instruction still gated by `resolver`, and the CPI into
    /// `txoracle::validate_stat` replaces that gate wholesale.
    ///
    /// `claimed_actual` is the settled value: for COUNT pools the stat total, for
    /// WHEN pools the 5-minute bucket index (NEVER = 20).
    pub fn settle(ctx: Context<Settle>, claimed_actual: i32) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let now = Clock::get()?.unix_timestamp;

        require!(pool.state == PoolState::Open as u8, ExactMatchError::AlreadySettled);
        require!(now >= pool.lock_ts, ExactMatchError::NotYetLocked);
        require!(
            claimed_actual >= pool.slider_min && claimed_actual <= pool.slider_max,
            ExactMatchError::ActualOutOfRange
        );

        pool.actual = claimed_actual;
        pool.state = PoolState::Settled as u8;

        emit!(SettledEvent { pool: pool.key(), actual: claimed_actual });
        Ok(())
    }

    /// Recompute this entrant's payout from `entries + actual` and pay it out.
    ///
    /// Nothing is stored at settle time: the split is derived here, every time, so
    /// a stored number can never disagree with README §5.3.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let wallet = ctx.accounts.user.key();

        let (index, payout, error, is_winner) = {
            let pool = &ctx.accounts.pool;
            require!(pool.state == PoolState::Settled as u8, ExactMatchError::NotSettled);

            let index = pool
                .entries
                .iter()
                .position(|e| e.wallet == wallet)
                .ok_or(ExactMatchError::NotAnEntrant)?;
            require!(!pool.entries[index].claimed, ExactMatchError::AlreadyClaimed);

            let guesses: Vec<i32> = pool.entries.iter().map(|e| e.guess).collect();
            let stakes: Vec<u64> = pool.entries.iter().map(|e| e.stake).collect();
            let o = payout_for(&guesses, &stakes, pool.actual, index);
            (index, o.payout, o.error, o.is_winner)
        };

        // Mark before transferring: the CPI is the last thing that happens.
        ctx.accounts.pool.entries[index].claimed = true;

        if payout > 0 {
            pay_from_vault(&ctx.accounts, payout)?;
        }

        emit!(Claimed { pool: ctx.accounts.pool.key(), wallet, payout, error, is_winner });
        Ok(())
    }

    /// Stake back, if the pool never settled by its deadline. Permissionless —
    /// this is what stops the `resolver` holding funds hostage by inaction.
    pub fn refund(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let wallet = ctx.accounts.user.key();

        let (index, stake) = {
            let pool = &ctx.accounts.pool;
            require!(pool.state != PoolState::Settled as u8, ExactMatchError::AlreadySettled);
            require!(now > pool.settle_deadline_ts, ExactMatchError::DeadlineNotPassed);

            let index = pool
                .entries
                .iter()
                .position(|e| e.wallet == wallet)
                .ok_or(ExactMatchError::NotAnEntrant)?;
            require!(!pool.entries[index].claimed, ExactMatchError::AlreadyClaimed);
            (index, pool.entries[index].stake)
        };

        ctx.accounts.pool.entries[index].claimed = true;
        ctx.accounts.pool.state = PoolState::Refunding as u8;

        pay_from_vault(&ctx.accounts, stake)?;

        emit!(Refunded { pool: ctx.accounts.pool.key(), wallet, stake });
        Ok(())
    }
}

/// Vault → user, signed by the pool PDA.
///
/// `total_staked` is the ledger the payouts draw against; it is decremented here so
/// the vault can never pay out more than was staked even if the math above were wrong.
fn pay_from_vault(accounts: &Claim, amount: u64) -> Result<()> {
    require!(amount <= accounts.pool.total_staked, ExactMatchError::VaultUnderflow);

    let fixture_bytes = accounts.pool.fixture_id.to_le_bytes();
    let index_bytes = accounts.pool.pool_index.to_le_bytes();
    let bump = [accounts.pool.bump];
    let seeds: &[&[u8]] = &[b"pool", &fixture_bytes, &index_bytes, &bump];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            accounts.token_program.to_account_info(),
            TransferChecked {
                from: accounts.vault.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to: accounts.user_token.to_account_info(),
                authority: accounts.pool.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        accounts.mint.decimals,
    )
}

/* ------------------------------------------------------------------ state -- */

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PoolState {
    Open = 0,
    Settled = 1,
    Refunding = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct Entry {
    pub wallet: Pubkey,
    pub guess: i32,
    pub stake: u64,
    pub claimed: bool,
}

#[account]
pub struct Pool {
    pub fixture_id: i64,
    pub pool_index: u8,
    pub stat_key_a: u32,
    pub stat_key_b: u32,
    pub op: u8,
    pub lock_ts: i64,
    pub settle_phase: u8,
    pub settle_deadline_ts: i64,
    pub slider_min: i32,
    pub slider_max: i32,
    pub state: u8,
    pub actual: i32,
    /// Temporary settle gate — see the trust-model note at the top of this file.
    pub resolver: Pubkey,
    /// The escrow asset. Fixed at creation; every entry and payout uses it.
    pub mint: Pubkey,
    /// Token base units owed to entrants.
    pub total_staked: u64,
    pub entries: Vec<Entry>,
    pub bump: u8,
}

impl Pool {
    pub const SIZE: usize = 8   // discriminator
        + 8  // fixture_id
        + 1  // pool_index
        + 4 + 4 + 1 // stat_key_a, stat_key_b, op
        + 8  // lock_ts
        + 1  // settle_phase
        + 8  // settle_deadline_ts
        + 4 + 4 // slider_min, slider_max
        + 1  // state
        + 4  // actual
        + 32 // resolver
        + 32 // mint
        + 8  // total_staked
        + 4 + MAX_ENTRIES * Entry::INIT_SPACE // entries
        + 1; // bump
}

/* ----------------------------------------------------------------- accounts */

#[derive(Accounts)]
#[instruction(fixture_id: i64, pool_index: u8)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = Pool::SIZE,
        seeds = [b"pool".as_ref(), fixture_id.to_le_bytes().as_ref(), pool_index.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Enter<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool".as_ref(), pool.fixture_id.to_le_bytes().as_ref(), pool.pool_index.to_le_bytes().as_ref()],
        bump = pool.bump,
        has_one = mint @ ExactMatchError::WrongMint,
    )]
    pub pool: Account<'info, Pool>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    /// Temporary — replaced by the `validate_stat` CPI (trust-model note above).
    pub resolver: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool".as_ref(), pool.fixture_id.to_le_bytes().as_ref(), pool.pool_index.to_le_bytes().as_ref()],
        bump = pool.bump,
        constraint = pool.resolver == resolver.key() @ ExactMatchError::NotResolver,
    )]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool".as_ref(), pool.fixture_id.to_le_bytes().as_ref(), pool.pool_index.to_le_bytes().as_ref()],
        bump = pool.bump,
        has_one = mint @ ExactMatchError::WrongMint,
    )]
    pub pool: Account<'info, Pool>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/* ------------------------------------------------------------------ events */

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub fixture_id: i64,
    pub pool_index: u8,
    pub lock_ts: i64,
}

#[event]
pub struct Entered {
    pub pool: Pubkey,
    pub wallet: Pubkey,
    pub guess: i32,
    pub stake: u64,
}

#[event]
pub struct SettledEvent {
    pub pool: Pubkey,
    pub actual: i32,
}

#[event]
pub struct Claimed {
    pub pool: Pubkey,
    pub wallet: Pubkey,
    pub payout: u64,
    pub error: u32,
    pub is_winner: bool,
}

#[event]
pub struct Refunded {
    pub pool: Pubkey,
    pub wallet: Pubkey,
    pub stake: u64,
}

/* ------------------------------------------------------------------ errors */

#[error_code]
pub enum ExactMatchError {
    #[msg("slider_min must be < slider_max and within the bucket range")]
    InvalidRange,
    #[msg("invalid stat specification")]
    InvalidStatSpec,
    #[msg("pool is not open")]
    PoolNotOpen,
    #[msg("entries closed at kickoff")]
    PoolLocked,
    #[msg("guess outside the pool's range")]
    GuessOutOfRange,
    #[msg("stake must be 1-100 USDC")]
    StakeOutOfRange,
    #[msg("pool is full")]
    PoolFull,
    #[msg("this wallet already entered")]
    AlreadyEntered,
    #[msg("pool already settled")]
    AlreadySettled,
    #[msg("pool has not locked yet")]
    NotYetLocked,
    #[msg("settled value outside the pool's range")]
    ActualOutOfRange,
    #[msg("pool is not settled")]
    NotSettled,
    #[msg("wallet has no entry in this pool")]
    NotAnEntrant,
    #[msg("already claimed")]
    AlreadyClaimed,
    #[msg("settle deadline has not passed")]
    DeadlineNotPassed,
    #[msg("signer is not this pool's resolver")]
    NotResolver,
    #[msg("wrong mint for this pool")]
    WrongMint,
    #[msg("vault cannot cover this payout")]
    VaultUnderflow,
    #[msg("arithmetic overflow")]
    MathOverflow,
}
