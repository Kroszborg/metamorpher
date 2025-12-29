"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useToast } from "./ui/use-toast";
import { Upload, X, GripVertical, FileImage, Download, Loader2 } from "lucide-react";
import { imagesToPdf } from "@/utils/pdf-converter";

interface ImageFile {
  id: string;
  file: File;
  preview: string;
}

export default function ImagesToPdf() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [pageSize, setPageSize] = useState<"a4" | "letter" | "legal">("a4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [isConverting, setIsConverting] = useState(false);
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newImages = acceptedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      preview: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"],
    },
    multiple: true,
  });

  const removeImage = (id: string) => {
    setImages((prev) => {
      const updated = prev.filter((img) => img.id !== id);
      const removed = prev.find((img) => img.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return updated;
    });
  };

  const onDragEnd = (result: any) => {
    if (!result.destination) return;

    const items = Array.from(images);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setImages(items);
  };

  const convertToPdf = async () => {
    if (images.length === 0) {
      toast({
        variant: "destructive",
        title: "No Images",
        description: "Please add at least one image to convert",
      });
      return;
    }

    setIsConverting(true);

    try {
      const pdfBlob = await imagesToPdf({
        images: images.map((img) => img.file),
        pageSize,
        orientation,
      });

      // Create download link
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `images-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Success!",
        description: `PDF created with ${images.length} image(s)`,
      });

      // Clear images after successful conversion
      images.forEach((img) => URL.revokeObjectURL(img.preview));
      setImages([]);
    } catch (error) {
      console.error("PDF conversion error:", error);
      toast({
        variant: "destructive",
        title: "Conversion Failed",
        description: error instanceof Error ? error.message : "Failed to create PDF",
      });
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-300 ${
          isDragActive
            ? "border-primary bg-primary/5 scale-105"
            : "border-border hover:border-primary/50 hover:bg-primary/5"
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 rounded-full bg-primary/10">
            <Upload className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-2">
              {isDragActive ? "Drop images here" : "Upload Images for PDF"}
            </h3>
            <p className="text-sm text-muted-foreground">
              Drag & drop images or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Supports: PNG, JPG, JPEG, GIF, BMP, WEBP
            </p>
          </div>
        </div>
      </div>

      {/* Settings */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Page Size:</label>
            <Select value={pageSize} onValueChange={(value: any) => setPageSize(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="letter">Letter</SelectItem>
                <SelectItem value="legal">Legal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Orientation:</label>
            <Select value={orientation} onValueChange={(value: any) => setOrientation(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">Portrait</SelectItem>
                <SelectItem value="landscape">Landscape</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto">
            <Button
              onClick={convertToPdf}
              disabled={isConverting || images.length === 0}
              className="gap-2"
            >
              {isConverting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Converting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Create PDF ({images.length} {images.length === 1 ? "image" : "images"})
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Image List with Drag & Drop */}
      {images.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Drag to reorder • Images will appear in this order in the PDF
          </p>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="images">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2"
                >
                  {images.map((image, index) => (
                    <Draggable key={image.id} draggableId={image.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`flex items-center gap-4 p-4 bg-card border rounded-lg transition-all ${
                            snapshot.isDragging ? "shadow-lg border-primary" : "hover:bg-accent/5"
                          }`}
                        >
                          <div
                            {...provided.dragHandleProps}
                            className="cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical className="w-5 h-5 text-muted-foreground" />
                          </div>

                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-12 h-12 rounded overflow-hidden bg-muted flex-shrink-0">
                              <img
                                src={image.preview}
                                alt={image.file.name}
                                className="w-full h-full object-cover"
                              />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{image.file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(image.file.size / 1024 / 1024).toFixed(2)} MB • Page {index + 1}
                              </p>
                            </div>
                          </div>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeImage(image.id)}
                            className="flex-shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      )}

      {images.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <FileImage className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p>No images added yet</p>
          <p className="text-sm">Upload images to create your PDF</p>
        </div>
      )}
    </div>
  );
}
