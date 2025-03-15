"use client";

import { Button } from "./ui/button";
import { Coffee, Heart } from "lucide-react";

interface DonationFooterProps {
  pocketsflowUrl: string;
}

export default function DonationFooter({
  pocketsflowUrl,
}: DonationFooterProps) {
  return (
    <div className="w-full py-8 mt-16 border-t border-border/40">
      <div className="container max-w-4xl mx-auto px-4">
        <div className="flex flex-col items-center justify-center space-y-6 text-center">
          <div className="flex flex-col items-center space-y-2">
            <div className="flex items-center gap-2 text-primary">
              <Heart className="w-5 h-5" />
              <h3 className="text-xl font-medium">Support MetaMorpher</h3>
            </div>
            <p className="text-muted-foreground max-w-md">
              MetaMorpher is completely free, with no ads or tracking. Your
              donations help cover hosting costs and support future development.
            </p>
          </div>

          <Button
            onClick={() => window.open(pocketsflowUrl, "_blank")}
            className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Coffee className="w-4 h-4 mr-2" />
            Make a Donation
          </Button>
        </div>
      </div>
    </div>
  );
}
