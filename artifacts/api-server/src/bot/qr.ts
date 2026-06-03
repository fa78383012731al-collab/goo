import QRCode from "qrcode";

export async function generateQrBuffer(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}
