import { createCanvas } from "canvas";

// Function to generate harmonious color pairs
const generateColorPair = (isDarkMode = false) => {
  // Generate a random hue (0-360)
  const baseHue = Math.floor(Math.random() * 360);

  // Choose a random color scheme
  const scheme = Math.floor(Math.random() * 4);
  let textHue;

  switch (scheme) {
    case 0: // Complementary (180 degrees)
      textHue = (baseHue + 180) % 360;
      break;
    case 1: // Analogous (30 degrees)
      textHue = (baseHue + 30) % 360;
      break;
    case 2: // Triadic (120 degrees)
      textHue = (baseHue + 120) % 360;
      break;
    case 3: // Split Complementary (150 degrees)
      textHue = (baseHue + 150) % 360;
      break;
  }

  // Convert to HSL and then to RGB
  const hslToRgb = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) =>
      l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [255 * f(0), 255 * f(8), 255 * f(4)];
  };

  // Generate colors based on mode with more varied saturation and lightness
  let bgColor, textColor;
  if (isDarkMode) {
    // Dark mode: more varied dark backgrounds, lighter text
    const bgSaturation = 60 + Math.random() * 30; // 60-90%
    const bgLightness = 10 + Math.random() * 10; // 10-20%
    const textSaturation = 70 + Math.random() * 20; // 70-90%
    const textLightness = 75 + Math.random() * 15; // 75-90%

    bgColor = hslToRgb(baseHue, bgSaturation, bgLightness);
    textColor = hslToRgb(textHue, textSaturation, textLightness);
  } else {
    // Light mode: more varied light backgrounds, darker text
    const bgSaturation = 50 + Math.random() * 30; // 50-80%
    const bgLightness = 85 + Math.random() * 10; // 85-95%
    const textSaturation = 70 + Math.random() * 20; // 70-90%
    const textLightness = 25 + Math.random() * 15; // 25-40%

    bgColor = hslToRgb(baseHue, bgSaturation, bgLightness);
    textColor = hslToRgb(textHue, textSaturation, textLightness);
  }

  // Convert RGB to hex
  const rgbToHex = (r, g, b) => {
    return (
      "#" +
      [r, g, b]
        .map((x) => {
          const hex = Math.round(x).toString(16);
          return hex.length === 1 ? "0" + hex : hex;
        })
        .join("")
    );
  };

  return {
    background: rgbToHex(...bgColor),
    text: rgbToHex(...textColor)
  };
};

export const generateTextImage = async (text) => {
  try {
    // Create a canvas with a modern, clean design
    const scale = 2; // 2x scale for retina
    const width = 768;
    const height = 768;
    const canvas = createCanvas(width * scale, height * scale);
    const ctx = canvas.getContext("2d");

    // Set image smoothing to true
    ctx.imageSmoothingEnabled = true;

    // Scale up the context
    ctx.scale(scale, scale);

    // Randomly choose between dark and light mode
    const isDarkMode = Math.random() < 0.5;

    // Generate random color pair
    const colors = generateColorPair(isDarkMode);

    // Set background
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);

    // Configure text
    ctx.fillStyle = colors.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Convert text to uppercase
    text = text.toUpperCase();

    // Calculate font size based on text length
    const maxWidth = width * 0.9; // Use more of the width
    let fontSize = 160; // Start with larger font size
    ctx.font = `bold ${fontSize}px 'DejaVu Sans Mono', 'DejaVu Sans', 'Liberation Sans', 'Bitstream Vera Sans', monospace`;

    // Split text into lines if needed
    const words = text.split(" ");
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = ctx.measureText(currentLine + " " + word).width;
      if (width < maxWidth) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);

    // Calculate optimal font size based on number of lines
    const minFontSize = 48; // Minimum font size
    const maxFontSize = 200; // Increased maximum font size

    // Calculate line height to fill available space
    const verticalPadding = height * 0.25; // 10% padding top and bottom combined
    const availableHeight = height - verticalPadding;
    const lineHeight = availableHeight / (lines.length - 1 || 1); // Adjust for single line case
    fontSize = Math.min(maxFontSize, Math.floor(lineHeight * 0.8)); // Font size is 80% of line height

    // Ensure text fits horizontally
    while (true) {
      ctx.font = `bold ${fontSize}px 'DejaVu Sans Mono', 'DejaVu Sans', 'Liberation Sans', 'Bitstream Vera Sans', monospace`;
      const fits = lines.every(
        (line) => ctx.measureText(line).width <= maxWidth
      );
      if (fits || fontSize <= minFontSize) break;
      fontSize -= 2;
    }

    // Draw text with shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.1)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Calculate vertical positions
    const totalTextHeight = lineHeight * (lines.length - 1);
    const startY = (height - totalTextHeight) / 2; // Center the text block vertically
    const margin = (width - maxWidth) / 2; // Calculate left margin

    lines.forEach((line, index) => {
      const words = line.split(" ");
      if (words.length === 1) {
        // For single words, justify letters
        const word = words[0];
        if (word.length > 1) {
          const letters = word.split("");
          const lettersWidth = letters.reduce(
            (acc, letter) => acc + ctx.measureText(letter).width,
            0
          );
          const totalSpace = maxWidth - lettersWidth;
          const spaceBetween = totalSpace / (letters.length - 1);

          let x = margin;
          letters.forEach((letter) => {
            ctx.fillText(letter, x, startY + index * lineHeight);
            x += ctx.measureText(letter).width + spaceBetween;
          });
        } else {
          // Center single letters
          ctx.textAlign = "center";
          ctx.fillText(word, width / 2, startY + index * lineHeight);
          ctx.textAlign = "left";
        }
      } else {
        // Calculate total width of words without spaces
        const wordsWidth = words.reduce(
          (acc, word) => acc + ctx.measureText(word).width,
          0
        );
        // Calculate total space needed
        const totalSpace = maxWidth - wordsWidth;
        // Calculate space between words
        const spaceBetween = totalSpace / (words.length - 1);

        // Draw each word with calculated spacing
        let x = margin;
        words.forEach((word) => {
          ctx.fillText(word, x, startY + index * lineHeight);
          x += ctx.measureText(word).width + spaceBetween;
        });
      }
    });

    // Create a new canvas at the target size
    const finalCanvas = createCanvas(width, height);
    const finalCtx = finalCanvas.getContext("2d");

    // Set high-quality image scaling for the final canvas
    finalCtx.imageSmoothingEnabled = false;

    // Draw the high-res canvas onto the final canvas, scaling down
    finalCtx.drawImage(canvas, 0, 0, width, height);

    // Convert final canvas to buffer
    const buffer = finalCanvas.toBuffer("image/png");

    // Convert buffer to base64
    const base64Image = buffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64Image}`;

    return {
      image: dataUrl,
      error: null
    };
  } catch (error) {
    console.error("Error in generateTextImage:", error);
    return {
      image: null,
      error: error.message
    };
  }
};
