import { toDataURL } from "qrcode";

export async function otpauthQrDataUrl(otpauthUri: string): Promise<string> {
  return toDataURL(otpauthUri, {
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
