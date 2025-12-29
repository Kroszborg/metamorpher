# MetaMorpher 🎨

**Free, unlimited, client-side file converter supporting 700+ conversion types**

![MetaMorpher Screenshot](https://github.com/Kroszborg/metamorpher/blob/main/public/metamorpher.png?raw=true)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Kroszborg/metamorpher)

---

## 🌟 Overview

MetaMorpher is a powerful, privacy-focused file conversion tool that runs entirely in your browser. Convert images, videos, audio, documents, and PDFs without uploading anything to a server.

### ✨ Why MetaMorpher?

- **🔒 100% Private**: All conversions happen in your browser - files never leave your device
- **⚡ Lightning Fast**: Powered by WebAssembly for native-like performance
- **💰 Completely Free**: No file size limits, no account required, no hidden fees
- **🎯 700+ Conversions**: Support for all major file formats
- **📱 Progressive Web App**: Install on your device and use offline
- **🌓 Dark Mode**: Beautiful interface that's easy on your eyes

---

## 🚀 Supported Conversions

### 🖼️ Images (144 conversions)
Convert between: **JPG, JPEG, PNG, GIF, BMP, WEBP, ICO, TIF, TIFF, SVG, RAW, TGA**

### 🎥 Videos (256+ conversions)
Convert between: **MP4, M4V, MP4V, 3GP, 3G2, AVI, MOV, WMV, MKV, FLV, OGV, WEBM, H264, 264, HEVC, 265**

**Special Features:**
- ✅ Video → GIF conversion
- ✅ GIF → Video conversion
- ✅ Video → Image (thumbnail extraction)
- ✅ All video formats → All image formats

### 🎵 Audio (49 conversions)
Convert between: **MP3, WAV, OGG, AAC, WMA, FLAC, M4A**

Extract audio from videos instantly!

### 📄 Documents (NEW - 50+ conversions)
- **Markdown** (`.md`) → PDF, HTML
- **HTML** (`.html`) → PDF
- **Text** (`.txt`) → PDF
- **DOCX** (`.docx`) → PDF, HTML, Markdown

### 📑 PDF (Enhanced)
- **PDF → Images**: Converts all pages to PNG/JPG (creates ZIP for multi-page)
- **Images → PDF**: Combine multiple images into one PDF with drag-to-reorder

---

## 🎯 Key Features

### Multi-Format Support
- **700+ conversion types** across images, videos, audio, and documents
- All major multimedia formats supported
- Batch conversion support

### Advanced Features
- 🎬 **Video Thumbnails**: Extract frames from videos as images
- 📑 **Multi-Page PDF**: Convert all PDF pages to images at once
- 🖼️ **Images to PDF**: Create PDFs from multiple images with custom ordering
- 📝 **Document Conversion**: Convert Markdown, HTML, and DOCX files

### Privacy & Performance
- Client-side processing with FFmpeg WebAssembly
- No server uploads - everything happens in your browser
- No file size restrictions
- Secure and private

### User Experience
- Drag-and-drop interface
- Real-time conversion progress
- Dark/Light mode support
- Mobile-responsive design
- PWA support (install as app)

---

## 🛠️ Tech Stack

- **[Next.js 15](https://nextjs.org/)** - React framework
- **[React 19](https://react.dev/)** - UI library
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety
- **[Tailwind CSS 3](https://tailwindcss.com/)** - Styling
- **[FFmpeg WebAssembly](https://github.com/ffmpegwasm/ffmpeg.wasm)** - Video/audio/image conversion
- **[PDF.js](https://mozilla.github.io/pdf.js/)** - PDF parsing
- **[jsPDF](https://github.com/parallax/jsPDF)** - PDF generation
- **[Mammoth.js](https://github.com/mwilliamson/mammoth.js)** - DOCX processing
- **[Markdown-it](https://github.com/markdown-it/markdown-it)** - Markdown parsing
- **[JSZip](https://stuk.github.io/jszip/)** - Archive handling
- **[shadcn/ui](https://ui.shadcn.com/)** - UI components
- **[next-pwa](https://github.com/shadowwalker/next-pwa)** - PWA support

---

## 📦 Getting Started

### Prerequisites
- **Node.js 18.x** or higher
- **npm** or **yarn**

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/Kroszborg/metamorpher.git
cd metamorpher
```

2. **Install dependencies:**
```bash
npm install
```

3. **Run development server:**
```bash
npm run dev
```

4. **Open your browser:**
Navigate to [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build
npm start
```

---

## 🌐 Deployment

### Deploy to Vercel (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Kroszborg/metamorpher)

**Or manually:**

1. Push your code to GitHub
2. Import project to [Vercel](https://vercel.com)
3. Deploy with zero configuration

### Environment Variables
No environment variables needed! Everything runs client-side.

---

## 💡 How to Use

### Basic Conversion
1. **Upload**: Drag and drop files or click to browse
2. **Select Format**: Choose the output format from the dropdown
3. **Convert**: Click "Convert All" button
4. **Download**: Get your converted files instantly

### Advanced Features

#### Create PDF from Images
1. Switch to **"Images to PDF"** tab
2. Upload multiple images
3. Drag to reorder pages
4. Select page size (A4, Letter, Legal)
5. Choose orientation (Portrait, Landscape)
6. Click "Create PDF"

#### Extract Video Thumbnail
1. Upload video file
2. Select output format (JPG, PNG, etc.)
3. Click on **"Image"** tab in the format selector
4. Choose image format
5. Convert to get thumbnail

#### Convert Multi-Page PDF to Images
1. Upload PDF file
2. Select PNG or JPG as output
3. Convert - get ZIP file with all pages

---

## 📚 Documentation

See [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for detailed technical documentation and implementation details.

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the project
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Write clean, readable code
- Test your changes thoroughly
- Update documentation as needed

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](./LICENSE) file for details.

---

## 🙏 Acknowledgments

- [FFmpeg](https://ffmpeg.org/) - Powerful multimedia framework
- [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) - WebAssembly port
- [PDF.js](https://mozilla.github.io/pdf.js/) - Mozilla's PDF renderer
- [jsPDF](https://github.com/parallax/jsPDF) - Client-side PDF generation
- [Mammoth.js](https://github.com/mwilliamson/mammoth.js) - DOCX to HTML/Markdown
- [shadcn/ui](https://ui.shadcn.com/) - Beautiful UI components
- [Next.js](https://nextjs.org/) - The React Framework
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS

---

## 📧 Contact

**Abhiman Panwar (Kroszborg)**

- GitHub: [@Kroszborg](https://github.com/Kroszborg)
- Project Link: [https://github.com/Kroszborg/metamorpher](https://github.com/Kroszborg/metamorpher)

---

## ⭐ Show Your Support

If you found this project helpful, please consider giving it a star on GitHub! It helps others discover the project.

[![GitHub stars](https://img.shields.io/github/stars/Kroszborg/metamorpher?style=social)](https://github.com/Kroszborg/metamorpher/stargazers)

---

## 🔮 Roadmap

- [ ] XLSX/CSV spreadsheet conversions
- [ ] EPUB ebook support
- [ ] Image editing features (crop, resize, filters)
- [ ] Batch ZIP download
- [ ] More document formats

---

**Made with ❤️ by [Kroszborg](https://github.com/Kroszborg)**
