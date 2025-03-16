"use client";

import { Button } from "./ui/button";
import { User, ExternalLink, Code, Shield, Coffee } from "lucide-react";
import Link from "next/link";
import { Badge } from "./ui/badge";

export default function AboutMeSection() {
  return (
    <div className="w-full py-16 bg-gradient-to-b from-primary/5 to-background">
      <div className="container max-w-4xl mx-auto px-4">
        <div className="flex flex-col items-center space-y-10">
          <div className="text-center space-y-2">
            <Badge className="bg-primary/10 text-primary border-none px-4 py-1 text-xs font-medium rounded-full">
              Who Made This?
            </Badge>
            <h2 className="text-3xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/70 mt-2">
              About the Developer
            </h2>
          </div>

          <div className="bg-card border rounded-xl shadow-lg overflow-hidden max-w-3xl">
            <div className="p-8">
              <div className="flex flex-col space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-1">
                    Hi there! I'm Abhiman Panwar aka Kroszborg
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Developer & Privacy Advocate
                  </p>
                </div>

                <p className="text-foreground/90 leading-relaxed">
                  I'm passionate about creating useful tools that respect user
                  privacy. MetaMorpher was built with a simple goal: to provide
                  a completely free and unlimited file conversion tool that
                  works directly in your browser—no uploads, no restrictions, no
                  tracking.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 py-2">
                  <div className="flex flex-col items-center p-3 rounded-lg bg-primary/5">
                    <Code className="w-5 h-5 text-primary mb-2" />
                    <span className="text-xs text-center">Web Developer</span>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-primary/5">
                    <Shield className="w-5 h-5 text-primary mb-2" />
                    <span className="text-xs text-center">Privacy Focused</span>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-primary/5">
                    <Coffee className="w-5 h-5 text-primary mb-2" />
                    <span className="text-xs text-center">Open Source</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 justify-start pt-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="flex items-center gap-2 bg-primary hover:bg-primary/90"
                    asChild
                  >
                    <Link
                      href="https://www.kroszborg.co/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <User className="w-4 h-4" />
                      <span>Visit My Portfolio</span>
                      <ExternalLink className="w-3 h-3 ml-1 opacity-70" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <p className="text-muted-foreground text-sm text-center max-w-xl">
            I believe in the power of browser-based technologies like
            WebAssembly to create applications that are fast, private, and
            accessible to everyone. If you found MetaMorpher useful, please
            consider checking out my other projects or supporting this one to
            help with hosting costs.
          </p>
        </div>
      </div>
    </div>
  );
}
