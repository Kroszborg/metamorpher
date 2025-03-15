import Link from "next/link";
import { ModeToggle } from "./mode-toggle";
import { Sparkles } from "lucide-react";

export default function Navbar() {
  return (
    <nav className="fixed z-50 w-full backdrop-blur-md bg-background/70 border-b border-border/40">
      <div className="container flex items-center justify-between h-16 px-4 mx-auto max-w-7xl md:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/70">
            MetaMorpher
          </span>
        </Link>
        
        <div className="flex items-center gap-6">
          
          <div className="flex items-center">
            <ModeToggle />
          </div>
        </div>
      </div>
    </nav>
  );
}