import { CommandCenter } from "@/components/command-center";

/**
 * The command centre is one live screen, so the page itself is a thin server
 * shell and the client boundary sits at the component that owns the socket.
 */
export default function Page() {
  return <CommandCenter />;
}
