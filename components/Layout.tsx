import Head from "next/head";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { Shell } from "@/components/Shell";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--v2-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--v2-mono",
  display: "swap",
});

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head>
        <title>Exact Match — precision pools, settled by proof</title>
        <meta
          name="description"
          content="Call the exact second. Settled trustlessly on Solana by TxLINE Merkle proofs — no admin key, no oracle committee, no human."
        />
      </Head>
      <div className={`v2-root ${archivo.variable} ${plexMono.variable}`}>
        <Shell>{children}</Shell>
      </div>
    </>
  );
}
