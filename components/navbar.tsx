"use client";

import Link from "next/link";
import { ModeToggle } from "./mode-toggle";
import { Sparkles, User, Github, Menu, X } from "lucide-react";
import DonationButton from "./donation-button";
import { useState } from "react";
import { Button } from "./ui/button";

// Your Pocketsflow product page URL
const POCKETSFLOW_URL =
  "https://kroszborg.pocketsflow.com/67d4fe92572eabaecbbe1027";

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  return (
    <nav className="fixed z-50 w-full backdrop-blur-md bg-background/70 border-b border-border/40">
      <div className="container flex items-center justify-between h-16 px-4 mx-auto max-w-7xl md:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold">
          <span className="text-primary">
            <Sparkles className="w-5 h-5" />
          </span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/70">
            MetaMorpher
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-6">
          <div className="flex items-center gap-6 text-sm">
            <Link
              href="https://www.kroszborg.co/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-foreground/80 hover:text-foreground transition-colors"
            >
              <User className="w-4 h-4" />
              <span>Portfolio</span>
            </Link>
            <DonationButton pocketsflowUrl={POCKETSFLOW_URL} />
          </div>

          <ModeToggle />
        </div>

        {/* Mobile Menu Button */}
        <div className="flex items-center gap-3 md:hidden">
          <ModeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMobileMenu}
            className="p-1"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden px-4 py-3 border-t border-border/10 bg-background/90 backdrop-blur-md">
          <div className="flex flex-col space-y-3">
            <Link
              href="https://www.kroszborg.co/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 py-2 px-2 rounded-md hover:bg-primary/5"
              onClick={() => setMobileMenuOpen(false)}
            >
              <User className="w-4 h-4" />
              <span>My Portfolio</span>
            </Link>
            <div className="py-2 px-2">
              <DonationButton pocketsflowUrl={POCKETSFLOW_URL} />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
