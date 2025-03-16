"use client";
import { FiUploadCloud } from "react-icons/fi";
import { LuFileSymlink } from "react-icons/lu";
import { MdClose } from "react-icons/md";
import ReactDropzone from "react-dropzone";
import bytesToSize from "@/utils/bytes-to-size";
import fileToIcon from "@/utils/file-to-icon";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import compressFileName from "@/utils/compress-file-name";
import { Skeleton } from "@/components/ui/skeleton";
import convertFile from "@/utils/convert";
import { ImSpinner3 } from "react-icons/im";
import { MdDone } from "react-icons/md";
import { Badge } from "@/components/ui/badge";
import { HiOutlineDownload } from "react-icons/hi";
import { BiError } from "react-icons/bi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";
import loadFfmpeg from "@/utils/load-ffmpeg";
import type { Action } from "@/types";
import { FFmpeg } from "@ffmpeg/ffmpeg";

const extensions = {
  image: [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "webp",
    "ico",
    "tif",
    "tiff",
    "svg",
    "raw",
    "tga",
  ],
  video: [
    "mp4",
    "m4v",
    "mp4v",
    "3gp",
    "3g2",
    "avi",
    "mov",
    "wmv",
    "mkv",
    "flv",
    "ogv",
    "webm",
    "h264",
    "264",
    "hevc",
    "265",
  ],
  audio: ["mp3", "wav", "ogg", "aac", "wma", "flac", "m4a"],
};

export default function Dropzone() {
  const { toast } = useToast();
  const [is_hover, setIsHover] = useState<boolean>(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [is_ready, setIsReady] = useState<boolean>(false);
  const [files, setFiles] = useState<Array<any>>([]);
  const [is_loaded, setIsLoaded] = useState<boolean>(false);
  const [is_converting, setIsConverting] = useState<boolean>(false);
  const [is_done, setIsDone] = useState<boolean>(false);
  const ffmpegRef = useRef<any>(null);
  const [defaultValues, setDefaultValues] = useState<string>("video");
  const [selected, setSelected] = useState<string>("...");
  const [selectionMap, setSelectionMap] = useState<Record<string, string>>({});
  const accepted_files = {
    "image/*": [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".bmp",
      ".webp",
      ".ico",
      ".tif",
      ".tiff",
      ".raw",
      ".tga",
    ],
    "audio/*": [],
    "video/*": [],
  };

  // Reset function - clear all state
  const reset = () => {
    setIsDone(false);
    setActions([]);
    setFiles([]);
    setIsReady(false);
    setIsConverting(false);
    setSelected("...");
    setSelectionMap({});
  };

  // Fixed download file function
  const downloadFile = (action: Action) => {
    if (!action.url || !action.output) {
      console.error("Missing URL or output for download", action);
      toast({
        variant: "destructive",
        title: "Download Error",
        description: "File information is incomplete for download",
        duration: 3000,
      });
      return;
    }

    try {
      // Create a new anchor element
      const a = document.createElement("a");
      a.href = action.url;
      a.download = action.output;
      a.style.display = "none";

      // Add to document, click, and cleanup
      document.body.appendChild(a);
      a.click();

      // Small delay before cleanup to ensure download begins
      setTimeout(() => {
        document.body.removeChild(a);
      }, 100);
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: "Could not download the file. Please try again.",
        duration: 3000,
      });
    }
  };

  // Fixed download all function
  const downloadAll = () => {
    const successfulActions = actions.filter(
      (action) =>
        action.is_converted && !action.is_error && action.url && action.output
    );

    if (successfulActions.length === 0) {
      toast({
        variant: "destructive",
        title: "No Files to Download",
        description: "There are no successfully converted files to download.",
        duration: 3000,
      });
      return;
    }

    // Download each file with a slight delay between them
    successfulActions.forEach((action, index) => {
      setTimeout(() => {
        downloadFile(action);
      }, index * 800); // Stagger downloads by 800ms
    });

    toast({
      title: "Downloads Started",
      description: `Started downloading ${successfulActions.length} file(s)`,
      duration: 3000,
    });
  };

  // Fixed convert function
  const convert = async () => {
    // Prevent conversion if not ready or already converting
    if (!is_ready || is_converting) {
      return;
    }

    try {
      // Check if FFmpeg is loaded
      if (!ffmpegRef.current) {
        toast({
          variant: "destructive",
          title: "Conversion Error",
          description:
            "The conversion engine is not loaded yet. Please wait or refresh the page.",
          duration: 3000,
        });
        return;
      }

      // Mark all actions as converting
      const updatedActions = actions.map((action) => ({
        ...action,
        is_converting: true,
        is_converted: false,
        is_error: false,
      }));

      setActions(updatedActions);
      setIsConverting(true);

      let successCount = 0;
      let errorCount = 0;

      // Process each file sequentially
      for (let i = 0; i < updatedActions.length; i++) {
        try {
          const result = await convertFile(
            ffmpegRef.current,
            updatedActions[i]
          );

          // Update this specific action as converted
          updatedActions[i] = {
            ...updatedActions[i],
            is_converting: false,
            is_converted: true,
            url: result.url,
            output: result.output,
          };

          // Update state to show progress
          setActions([...updatedActions]);
          successCount++;
        } catch (error) {
          console.error(
            `Error converting file ${updatedActions[i].file_name}:`,
            error
          );

          // Mark this specific action as having an error
          updatedActions[i] = {
            ...updatedActions[i],
            is_converting: false,
            is_converted: false,
            is_error: true,
          };

          // Update state to show the error
          setActions([...updatedActions]);
          errorCount++;
        }
      }

      // All files processed, update final state
      setIsConverting(false);
      setIsDone(true);

      // Show appropriate toast message
      if (errorCount === 0) {
        toast({
          title: "Conversion Complete",
          description: `Successfully converted ${successCount} file(s)`,
          duration: 3000,
        });
      } else if (successCount === 0) {
        toast({
          variant: "destructive",
          title: "Conversion Failed",
          description: `All ${errorCount} file(s) failed to convert`,
          duration: 3000,
        });
      } else {
        toast({
          variant: "default",
          title: "Conversion Partially Complete",
          description: `${successCount} file(s) converted, ${errorCount} file(s) failed`,
          duration: 3000,
        });
      }
    } catch (error) {
      // Handle any unexpected errors
      console.error("Unexpected conversion error:", error);
      setIsConverting(false);

      toast({
        variant: "destructive",
        title: "Conversion Error",
        description: "An unexpected error occurred during conversion",
        duration: 3000,
      });
    }
  };

  const handleUpload = (data: Array<any>): void => {
    handleExitHover();
    setFiles(data);
    const tmp: Action[] = [];

    // Reset previous state
    setActions([]);
    setSelectionMap({});
    setSelected("...");
    setIsDone(false);

    // Process each uploaded file
    data.forEach((file: any) => {
      const fileExtension = file.name.slice(
        ((file.name.lastIndexOf(".") - 1) >>> 0) + 2
      );

      tmp.push({
        file_name: file.name,
        file_size: file.size,
        from: fileExtension,
        to: null,
        file_type: file.type,
        file,
        is_converted: false,
        is_converting: false,
        is_error: false,
      });
    });

    setActions(tmp);
  };

  const handleHover = (): void => setIsHover(true);
  const handleExitHover = (): void => setIsHover(false);

  // Update action with selected format
  const updateAction = (file_name: String, to: String) => {
    // Update the selection map to keep track of selections per file
    setSelectionMap((prev) => ({
      ...prev,
      [file_name.toString()]: to.toString(),
    }));

    // Update the action with the selected format
    setActions(
      actions.map((action): Action => {
        if (action.file_name === file_name) {
          return {
            ...action,
            to,
          };
        }
        return action;
      })
    );
  };

  // Check if all files have a selected output format
  const checkIsReady = (): void => {
    let tmp_is_ready = true;
    actions.forEach((action: Action) => {
      if (!action.to) tmp_is_ready = false;
    });
    setIsReady(tmp_is_ready);
  };

  // Remove a file from the list
  const deleteAction = (action: Action): void => {
    // Remove from actions array
    setActions(actions.filter((elt) => elt !== action));

    // Remove from files array
    setFiles(files.filter((elt) => elt.name !== action.file_name));

    // Remove from selection map
    const newSelectionMap = { ...selectionMap };
    delete newSelectionMap[action.file_name];
    setSelectionMap(newSelectionMap);
  };

  // Effect to check if all files have formats selected
  useEffect(() => {
    if (!actions.length) {
      setIsDone(false);
      setFiles([]);
      setIsReady(false);
      setIsConverting(false);
    } else {
      checkIsReady();
    }
  }, [actions]);

  // Load FFmpeg on component mount
  useEffect(() => {
    const loadFFmpeg = async () => {
      try {
        const ffmpeg_response = await loadFfmpeg();
        ffmpegRef.current = ffmpeg_response;
        setIsLoaded(true);
      } catch (error) {
        console.error("Failed to load FFmpeg:", error);
        setIsLoaded(false);
        toast({
          variant: "destructive",
          title: "Failed to Load Conversion Engine",
          description: "Please refresh the page and try again.",
          duration: 5000,
        });
      }
    };

    loadFFmpeg();
  }, []);

  // Render files list and actions if files are added
  if (actions.length) {
    return (
      <div className="space-y-6">
        <div className="p-1 bg-secondary/30 rounded-xl">
          {actions.map((action: Action, i: any) => (
            <div
              key={i}
              className="relative flex flex-wrap items-center justify-between w-full px-4 py-3 my-2 space-y-2 bg-card border-0 shadow-sm lg:py-2 rounded-lg lg:flex-nowrap"
            >
              {!is_loaded && (
                <Skeleton className="absolute w-full h-full -ml-10 cursor-progress rounded-xl" />
              )}
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-10 h-10 text-xl rounded-full bg-primary/10 text-primary">
                  {fileToIcon(action.file_type)}
                </span>
                <div className="flex items-center gap-1 max-w-xs">
                  <span className="overflow-x-hidden font-medium text-sm">
                    {compressFileName(action.file_name)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({bytesToSize(action.file_size)})
                  </span>
                </div>
              </div>

              {action.is_error ? (
                <Badge
                  variant="destructive"
                  className="flex gap-1 text-xs font-normal"
                >
                  <span>Error Converting</span>
                  <BiError />
                </Badge>
              ) : action.is_converted ? (
                <Badge
                  variant="default"
                  className="flex gap-1 text-xs font-normal bg-green-500"
                >
                  <span>Done</span>
                  <MdDone />
                </Badge>
              ) : action.is_converting ? (
                <Badge
                  variant="default"
                  className="flex gap-1 text-xs font-normal"
                >
                  <span>Converting</span>
                  <span className="animate-spin">
                    <ImSpinner3 />
                  </span>
                </Badge>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Convert to</span>
                  <Select
                    onValueChange={(value) => {
                      if (extensions.audio.includes(value)) {
                        setDefaultValues("audio");
                      } else if (extensions.video.includes(value)) {
                        setDefaultValues("video");
                      }
                      updateAction(action.file_name, value);
                    }}
                    value={selectionMap[action.file_name] || selected}
                  >
                    <SelectTrigger className="w-24 h-8 text-xs font-medium text-center outline-none focus:outline-none focus:ring-0 text-foreground bg-secondary/50 border-0">
                      <SelectValue placeholder="..." />
                    </SelectTrigger>
                    <SelectContent className="h-fit max-h-56 overflow-y-auto border-0 shadow-md bg-card">
                      {action.file_type.includes("image") && (
                        <div className="grid grid-cols-2 gap-1 w-fit">
                          {extensions.image.map((elt, i) => (
                            <div key={i} className="col-span-1 text-center">
                              <SelectItem
                                value={elt}
                                className="mx-auto text-xs"
                              >
                                {elt}
                              </SelectItem>
                            </div>
                          ))}
                        </div>
                      )}
                      {action.file_type.includes("video") && (
                        <Tabs defaultValue={defaultValues} className="w-full">
                          <TabsList className="w-full mb-2 bg-secondary/50">
                            <TabsTrigger
                              value="video"
                              className="w-full text-xs"
                            >
                              Video
                            </TabsTrigger>
                            <TabsTrigger
                              value="audio"
                              className="w-full text-xs"
                            >
                              Audio
                            </TabsTrigger>
                          </TabsList>
                          <TabsContent value="video">
                            <div className="grid grid-cols-3 gap-1 w-fit">
                              {extensions.video.map((elt, i) => (
                                <div key={i} className="col-span-1 text-center">
                                  <SelectItem
                                    value={elt}
                                    className="mx-auto text-xs"
                                  >
                                    {elt}
                                  </SelectItem>
                                </div>
                              ))}
                            </div>
                          </TabsContent>
                          <TabsContent value="audio">
                            <div className="grid grid-cols-3 gap-1 w-fit">
                              {extensions.audio.map((elt, i) => (
                                <div key={i} className="col-span-1 text-center">
                                  <SelectItem
                                    value={elt}
                                    className="mx-auto text-xs"
                                  >
                                    {elt}
                                  </SelectItem>
                                </div>
                              ))}
                            </div>
                          </TabsContent>
                        </Tabs>
                      )}
                      {action.file_type.includes("audio") && (
                        <div className="grid grid-cols-2 gap-1 w-fit">
                          {extensions.audio.map((elt, i) => (
                            <div key={i} className="col-span-1 text-center">
                              <SelectItem
                                value={elt}
                                className="mx-auto text-xs"
                              >
                                {elt}
                              </SelectItem>
                            </div>
                          ))}
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {action.is_converted ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadFile(action)}
                  className="flex items-center gap-1 text-xs h-8 px-2 text-foreground/80 hover:text-foreground"
                >
                  <HiOutlineDownload className="w-4 h-4" />
                  Download
                </Button>
              ) : (
                <button
                  title="Delete"
                  type="button"
                  onClick={() => deleteAction(action)}
                  className="flex items-center justify-center w-8 h-8 text-sm rounded-full hover:bg-muted text-foreground/60 hover:text-foreground transition-colors"
                >
                  <MdClose />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end w-full">
          {is_done ? (
            <div className="space-y-3 w-fit">
              <Button
                size="lg"
                type="button"
                className="relative flex items-center w-full gap-2 py-4 font-medium bg-primary hover:bg-primary/90 rounded-xl text-sm"
                onClick={() => downloadAll()}
              >
                {actions.length > 1 ? "Download All Files" : "Download File"}
                <HiOutlineDownload />
              </Button>
              <Button
                size="lg"
                type="button"
                onClick={() => reset()}
                variant="outline"
                className="w-full text-sm rounded-xl"
              >
                Convert Another File
              </Button>
            </div>
          ) : (
            <Button
              size="lg"
              type="button"
              disabled={!is_ready || is_converting || !is_loaded}
              className="relative flex items-center py-4 font-medium rounded-xl text-sm w-44 bg-primary hover:bg-primary/90"
              onClick={() => convert()}
            >
              {is_converting ? (
                <span className="flex items-center gap-2">
                  <ImSpinner3 className="animate-spin" />
                  Converting...
                </span>
              ) : (
                <span>Convert Now</span>
              )}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Render the dropzone if no files are present
  return (
    <ReactDropzone
      onDrop={handleUpload}
      onDragEnter={handleHover}
      onDragLeave={handleExitHover}
      accept={accepted_files}
      onDropRejected={() => {
        handleExitHover();
        toast({
          variant: "destructive",
          title: "Error uploading file(s)",
          description: "Allowed files: Audio, Video and Images",
          duration: 5000,
        });
      }}
      onError={() => {
        handleExitHover();
        toast({
          variant: "destructive",
          title: "Error uploading file(s)",
          description: "Allowed files: Audio, Video and Images",
          duration: 5000,
        });
      }}
    >
      {({ getRootProps, getInputProps }) => (
        <div
          {...getRootProps()}
          className={`flex flex-col items-center justify-center border-2 border-dashed cursor-pointer transition-all duration-200 bg-background h-72 lg:h-80 xl:h-72 rounded-xl border-primary/20 ${
            is_hover ? "bg-primary/5 border-primary/40" : ""
          }`}
        >
          <input {...getInputProps()} />
          <div className="space-y-4 text-center">
            {is_hover ? (
              <>
                <div className="flex justify-center text-5xl text-primary/80">
                  <LuFileSymlink />
                </div>
                <div>
                  <h3 className="text-xl font-medium text-foreground">
                    Drop your files here
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Release to start converting
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-center p-6 mx-auto text-5xl rounded-full w-fit bg-primary/5 text-primary/80">
                  <FiUploadCloud />
                </div>
                <div>
                  <h3 className="text-xl font-medium text-foreground">
                    Drag & drop files here
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Or click to browse your device
                  </p>
                  <p className="mt-6 px-10 text-xs text-muted-foreground">
                    Supports images, audio, and videos in all major formats
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </ReactDropzone>
  );
}
