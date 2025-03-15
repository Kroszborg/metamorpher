"use client";

import { Coffee } from "lucide-react";
import { Button } from "./ui/button";

interface DonationButtonProps {
  pocketsflowUrl: string;
}

export default function DonationButton({
  pocketsflowUrl,
}: DonationButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="flex items-center gap-2 border-primary/30 hover:bg-primary/5 text-primary"
      onClick={() => window.open(pocketsflowUrl, "_blank")}
    >
      <Coffee className="w-4 h-4" />
      <span>Support Project</span>
    </Button>
  );
}
