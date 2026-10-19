import qrcode from 'qrcode-generator';

const SVG_NS = 'http://www.w3.org/2000/svg';
const QUIET_ZONE = 2;

/** A QR code as an SVG element, built from the module matrix (no HTML strings). */
export function qrSvg(text: string, label: string): SVGSVGElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;

  let squares = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) squares += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#fff');
  const modules = document.createElementNS(SVG_NS, 'path');
  modules.setAttribute('d', squares);
  modules.setAttribute('fill', '#000');
  svg.append(background, modules);
  return svg;
}
