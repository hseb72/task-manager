import { Injectable } from '@angular/core';

/**
 * Service de pré-traitement d'image avant OCR.
 *
 * Tesseract reconnaît bien mieux du texte sur :
 *  - du noir-sur-blanc (binarisé)
 *  - une résolution > 300 DPI (donc on upscale les petites images)
 *  - sans bruit de couleur (donc grayscale)
 *
 * Toutes les opérations utilisent <canvas> natif, sans dépendance.
 */
@Injectable({ providedIn: 'root' })
export class ImagePreprocessService {
  /**
   * Renvoie un Blob PNG pré-traité prêt pour Tesseract.
   * Renvoie aussi les dimensions finales (utiles pour mapper les bbox sur l'aperçu).
   */
  async preprocess(file: File | Blob): Promise<{ blob: Blob; width: number; height: number; scaleFactor: number }> {
    const img = await this.loadImage(file);

    // Upscale si l'image est petite (cible : largeur >= 1500px)
    const targetWidth = 1500;
    const scale = img.width < targetWidth ? targetWidth / img.width : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    // Filtrage : grayscale + contraste léger appliqué au moment du draw
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    // Lecture des pixels et conversion en niveaux de gris
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      // Luminance ITU-R BT.601
      gray[j] = Math.round(data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114);
    }

    // Binarisation Otsu : trouve automatiquement le seuil optimal
    const threshold = this.otsuThreshold(gray);

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const v = gray[j]! >= threshold ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    });

    return { blob, width: w, height: h, scaleFactor: scale };
  }

  /** Charge un fichier image en HTMLImageElement. */
  private loadImage(file: File | Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  /**
   * Calcule le seuil de binarisation optimal (méthode d'Otsu).
   * Maximise la variance inter-classes entre pixels sombres et clairs.
   */
  private otsuThreshold(gray: Uint8ClampedArray): number {
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]!]++;

    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t]!;

    let sumB = 0;
    let wB = 0;
    let varMax = 0;
    let threshold = 127;

    for (let t = 0; t < 256; t++) {
      wB += hist[t]!;
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t]!;
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }
}
