import Dropzone from "@/components/dropzone";
import { Check, Zap, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import DonationFooter from "@/components/donation-footer";

// Your Pocketsflow checkout URL
const POCKETSFLOW_URL =
  "https://kroszborg.pocketsflow.com/67d4fe92572eabaecbbe1027";

export default function Home() {
  return (
    <>
      <div className="pb-8 space-y-16">
        {/* Hero Section */}
        <div className="space-y-8">
          <div className="flex justify-center">
            <Badge
              variant="outline"
              className="px-4 py-1 text-sm font-medium border-primary/30 bg-primary/5"
            >
              Fast & Free Conversions
            </Badge>
          </div>

          <h1 className="text-4xl font-bold text-center md:text-6xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/70">
            Free Unlimited File Converter
          </h1>

          <p className="text-center text-muted-foreground text-md md:text-lg md:px-24 xl:px-44 2xl:px-52">
            Transform your media files without limits. Convert images, audio,
            and videos quickly and easily with no file size restrictions, all in
            your browser.
          </p>

          {/* Features */}
          <div className="grid grid-cols-1 gap-6 mt-8 md:grid-cols-3">
            <div className="flex flex-col items-center p-6 space-y-2 border rounded-xl bg-card/30 shadow-sm">
              <div className="p-2 rounded-full bg-primary/10">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-medium">Lightning Fast</h3>
              <p className="text-sm text-center text-muted-foreground">
                Process files instantly in your browser with no uploads needed
              </p>
            </div>

            <div className="flex flex-col items-center p-6 space-y-2 border rounded-xl bg-card/30 shadow-sm">
              <div className="p-2 rounded-full bg-primary/10">
                <Check className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-medium">Privacy First</h3>
              <p className="text-sm text-center text-muted-foreground">
                All conversions happen locally, your files never leave your
                device
              </p>
            </div>

            <div className="flex flex-col items-center p-6 space-y-2 border rounded-xl bg-card/30 shadow-sm">
              <div className="p-2 rounded-full bg-primary/10">
                <RefreshCw className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-medium">Any Format</h3>
              <p className="text-sm text-center text-muted-foreground">
                Support for all major image, audio, and video formats
              </p>
            </div>
          </div>
        </div>

        {/* File Drop Section */}
        <div className="space-y-6">
          <h2 className="text-2xl font-medium text-center">
            Start Converting Now
          </h2>
          <Dropzone />
        </div>
      </div>

      {/* Donation Footer */}
      <DonationFooter pocketsflowUrl={POCKETSFLOW_URL} />
    </>
  );
}
