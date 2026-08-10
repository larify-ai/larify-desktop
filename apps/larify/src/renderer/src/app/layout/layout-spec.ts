export const layoutSpec = {
  navigation: { defaultSize: 240, minSize: 180, maxSize: 520 },
  interaction: { minSize: 336 },
  workbench: { defaultSize: 500, minSize: 280 }
} as const

export const expandedContentMinSize = layoutSpec.interaction.minSize + layoutSpec.workbench.minSize

export function mainLayoutDefaultSizes(viewportWidth: number): [number, number] {
  const navigationSize = layoutSpec.navigation.defaultSize
  return [navigationSize, viewportWidth - navigationSize]
}
