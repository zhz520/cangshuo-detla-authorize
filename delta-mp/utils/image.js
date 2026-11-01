export function thumbnailUrl(source, width = 640) {
  if (typeof source !== 'string') return ''
  // Only local public uploads use our thumbnail service. External hosts are unchanged.
  if (!/^\/file\/\d{4}\/\d{2}\/\d{2}\/[a-f\d-]{32,36}\.(png|jpe?g|gif)$/i.test(source)) return source
  const size = [160, 320, 640, 1080].find(value => value >= width) || 1080
  return source.replace('/file/', `/file/thumbnail/${size}/`)
}
