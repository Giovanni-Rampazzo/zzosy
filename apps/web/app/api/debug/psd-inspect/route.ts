import { NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"

/**
 * GET /api/debug/psd-inspect?path=<absolute_path_to_psd>
 *
 * L\u00ea um PSD do disco e retorna estrutura plana de cada layer:
 *  - name, hasText, textContent (se houver), hasCanvas, hasChildren
 *
 * USO:
 *   curl "http://localhost:3000/api/debug/psd-inspect?path=/Users/.../foo.psd"
 *
 * REMOVER apos diagnostico.
 */

function flattenLayers(layers: any[]): any[] {
  const result: any[] = []
  for (const layer of layers) {
    if (layer.children?.length) result.push(...flattenLayers(layer.children))
    else result.push(layer)
  }
  return result
}

export async function GET(req: NextRequest) {
  const pathParam = req.nextUrl.searchParams.get("path")
  if (!pathParam) {
    return NextResponse.json({ error: "path obrigatorio" }, { status: 400 })
  }

  let buffer: Buffer
  try {
    buffer = await readFile(pathParam)
  } catch (e: any) {
    return NextResponse.json({ error: "falha ao ler arquivo", detail: e?.message }, { status: 400 })
  }

  let psd: any
  try {
    const agPsd = await import("ag-psd")
    psd = agPsd.readPsd(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true })
  } catch (e: any) {
    return NextResponse.json({ error: "falha ao ler PSD", detail: e?.message }, { status: 500 })
  }

  const allLayers = flattenLayers(psd.children ?? [])
  const layerSummary = allLayers.map((l: any) => ({
    name: l.name,
    hasText: !!l.text,
    textContent: l.text?.text?.slice(0, 100) ?? null,
    textKeys: l.text ? Object.keys(l.text) : null,
    hasCanvas: !!l.canvas,
    left: l.left, top: l.top, right: l.right, bottom: l.bottom,
    hidden: l.hidden,
  }))

  return NextResponse.json({
    psd_width: psd.width,
    psd_height: psd.height,
    total_layers: allLayers.length,
    layers: layerSummary,
  })
}
