import QRCode from "qrcode";

// Generates a QR code PNG for a share link on the fly — no storage, no
// state, just text in and an image out. Length is capped well above any
// real share link (token URLs are ~60-90 chars even with an encryption key
// fragment) purely to stop someone using this as a way to generate huge
// QR codes for unrelated arbitrary text.
const MAX_TEXT_LENGTH = 500;

export const generateQr = async (req, res) => {
  try {
    const text = req.query.text;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ message: "Missing ?text= to encode" });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ message: `Text too long for a QR code (max ${MAX_TEXT_LENGTH} characters)` });
    }

    const buffer = await QRCode.toBuffer(text, {
      type: "png",
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store"); // share links are secrets — never let a cache retain this
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
