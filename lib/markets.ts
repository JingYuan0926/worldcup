/** Static taxonomy. Soccer is the only live sport; the rest sell the venue at zero build cost. */

export interface SportTab {
  id: string;
  label: string;
  soon: boolean;
}

export const SPORTS: SportTab[] = [
  { id: "soccer", label: "Soccer", soon: false },
  { id: "basketball", label: "Basketball", soon: true },
  { id: "football", label: "Football", soon: true },
  { id: "tennis", label: "Tennis", soon: true },
  { id: "cricket", label: "Cricket", soon: true },
  { id: "mma", label: "MMA", soon: true },
  { id: "motorsport", label: "Motorsport", soon: true },
  { id: "baseball", label: "Baseball", soon: true },
];

export interface LeagueTab {
  id: string;
  label: string;
  soon: boolean;
}

export const LEAGUES: LeagueTab[] = [
  { id: "wc26", label: "FIFA World Cup 2026", soon: false },
  { id: "epl", label: "Premier League", soon: true },
  { id: "laliga", label: "La Liga", soon: true },
  { id: "ucl", label: "Champions League", soon: true },
  { id: "mls", label: "MLS", soon: true },
  { id: "seriea", label: "Serie A", soon: true },
];

export const FILTERS = ["All", "Live", "Upcoming", "Volume", "Closing soon"];

export interface MarketCard {
  fixtureId: number;
  comp: string;
  live: boolean;
  clock?: string;
  when?: string;
  urgent?: boolean;
  homeName: string;
  homeFlag: string;
  homeScore: string;
  awayName: string;
  awayFlag: string;
  awayScore: string;
  volume: string;
  markets: string;
  spark: number[];
}

export const CARDS: MarketCard[] = [
  {
    // Live match recorded from the real TxLINE devnet feed (fixture 18257739).
    fixtureId: 18257739,
    comp: "Semi-final",
    live: true,
    clock: "11'",
    homeName: "Spain",
    homeFlag: "https://flagcdn.com/w80/es.png",
    homeScore: "0",
    awayName: "Argentina",
    awayFlag: "https://flagcdn.com/w80/ar.png",
    awayScore: "0",
    volume: "—",
    markets: "live · TxLINE feed",
    spark: [3, 5, 4, 8, 7, 11, 10, 14, 16, 15, 19, 23],
  },
  {
    fixtureId: 18209181,
    comp: "Quarter-final",
    live: true,
    clock: "34'",
    homeName: "Argentina",
    homeFlag: "https://flagcdn.com/w80/ar.png",
    homeScore: "1",
    awayName: "Switzerland",
    awayFlag: "https://flagcdn.com/w80/ch.png",
    awayScore: "0",
    volume: "12,480",
    markets: "3 flash live",
    spark: [4, 6, 5, 9, 8, 14, 12, 18, 22, 19, 26, 31],
  },
  {
    fixtureId: 18209182,
    comp: "Quarter-final",
    live: false,
    when: "in 11:08",
    urgent: true,
    homeName: "Brazil",
    homeFlag: "https://flagcdn.com/w80/br.png",
    homeScore: "–",
    awayName: "Portugal",
    awayFlag: "https://flagcdn.com/w80/pt.png",
    awayScore: "–",
    volume: "9,120",
    markets: "opens at kickoff",
    spark: [2, 3, 5, 4, 8, 7, 11, 15, 14, 20, 24, 28],
  },
  {
    fixtureId: 18209183,
    comp: "Quarter-final",
    live: false,
    when: "Jul 18 · 20:00",
    homeName: "France",
    homeFlag: "https://flagcdn.com/w80/fr.png",
    homeScore: "–",
    awayName: "Morocco",
    awayFlag: "https://flagcdn.com/w80/ma.png",
    awayScore: "–",
    volume: "6,740",
    markets: "opens at kickoff",
    spark: [1, 2, 2, 4, 3, 6, 5, 8, 9, 12, 11, 16],
  },
  {
    fixtureId: 18209184,
    comp: "Quarter-final",
    live: false,
    when: "Jul 18 · 23:00",
    homeName: "Spain",
    homeFlag: "https://flagcdn.com/w80/es.png",
    homeScore: "–",
    awayName: "Japan",
    awayFlag: "https://flagcdn.com/w80/jp.png",
    awayScore: "–",
    volume: "5,310",
    markets: "opens at kickoff",
    spark: [1, 1, 3, 2, 5, 4, 7, 6, 9, 8, 13, 15],
  },
  {
    fixtureId: 18198205,
    comp: "Round of 16",
    live: false,
    when: "Settled",
    homeName: "Portugal",
    homeFlag: "https://flagcdn.com/w80/pt.png",
    homeScore: "2",
    awayName: "Spain",
    awayFlag: "https://flagcdn.com/w80/es.png",
    awayScore: "1",
    volume: "18,220",
    markets: "settled by proof",
    spark: [8, 12, 11, 17, 20, 24, 23, 28, 30, 29, 32, 32],
  },
  {
    fixtureId: 18172489,
    comp: "Round of 16",
    live: false,
    when: "Settled",
    homeName: "Brazil",
    homeFlag: "https://flagcdn.com/w80/br.png",
    homeScore: "3",
    awayName: "Japan",
    awayFlag: "https://flagcdn.com/w80/jp.png",
    awayScore: "0",
    volume: "14,905",
    markets: "settled by proof",
    spark: [6, 9, 13, 12, 18, 21, 20, 25, 27, 26, 30, 30],
  },
];

export function sparkPoints(values: number[], w = 96, h = 20): string {
  const max = Math.max(...values, 1);
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - (v / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
