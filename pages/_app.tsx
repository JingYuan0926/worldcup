import "@/styles/globals.css";
import "@/styles/ui.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import type { AppProps } from "next/app";
import { WalletProvider } from "@/components/WalletProvider";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WalletProvider>
      <Component {...pageProps} />
    </WalletProvider>
  );
}
