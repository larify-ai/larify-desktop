export const layoutSpec = {
  navigation: { defaultSize: 240, minSize: 240, maxSize: 520 },
  interaction: { minSize: 352 },
  workbench: { defaultSize: '36%', minSize: 320 }
} as const

export const expandedContentMinSize = layoutSpec.interaction.minSize + layoutSpec.workbench.minSize
