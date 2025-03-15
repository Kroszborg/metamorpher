# MetaMorpher

A free, unlimited, client-side file conversion tool for multimedia files.

![MetaMorpher Screenshot](public\metamorpher.png)

## About

MetaMorpher is a web-based file conversion tool that allows you to convert various multimedia files directly in your browser. All processing happens client-side using WebAssembly, ensuring your files never leave your device.

### Key Features

- **Client-side Conversion**: All file processing happens in your browser
- **Privacy-focused**: Your files never leave your device
- **No File Size Limits**: Convert files of any size
- **Multiple Format Support**: 
  - Images: jpg, jpeg, png, gif, bmp, webp, ico, tif, tiff, svg, raw, tga
  - Videos: mp4, m4v, mp4v, 3gp, 3g2, avi, mov, wmv, mkv, flv, ogv, webm, and more
  - Audio: mp3, wav, ogg, aac, wma, flac, m4a
- **No Account Required**: Just drag, drop, and convert
- **Dark Mode Support**: Comfortable usage day or night

## Getting Started

### Prerequisites

- Node.js (v16.x or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/metamorpher.git
cd metamorpher
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Run the development server:
```bash
npm run dev
# or
yarn dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser to see the result.

### Deployment

This project can be easily deployed on [Vercel](https://vercel.com). Simply connect your GitHub repository to Vercel for automatic deployments.

```bash
npm run build
# or
yarn build
```

## How It Works

MetaMorpher uses FFmpeg compiled to WebAssembly to handle file conversions directly in the browser:

1. **Upload**: Drag and drop files or click to browse
2. **Select Format**: Choose the output format for each file
3. **Convert**: Process files with FFmpeg in the browser
4. **Download**: Get your converted files instantly

## Tech Stack

- **Next.js**: React framework for the frontend
- **TypeScript**: For type safety and better developer experience
- **Tailwind CSS**: For styling
- **FFmpeg WebAssembly**: Powers the conversion process
- **React Dropzone**: Handles file uploads
- **shadcn/ui**: UI component library

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [FFmpeg](https://ffmpeg.org/) for the powerful multimedia framework
- [@ffmpeg/ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) for the WebAssembly port
- [shadcn/ui](https://ui.shadcn.com/) for the beautiful UI components
- [Next.js](https://nextjs.org/) for the React framework
- [Tailwind CSS](https://tailwindcss.com/) for the utility-first CSS