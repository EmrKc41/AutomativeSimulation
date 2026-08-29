import { ShopFloor } from "@/components/shop-floor";

/**
 * The 3D view, full screen, on its own route.
 *
 * Its own tab so it can go on a wall display without the panels, and so a
 * supervisor can open it beside the command centre rather than instead of it.
 */
export default function SahaPage() {
  return <ShopFloor />;
}
