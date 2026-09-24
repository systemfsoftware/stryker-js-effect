export const headline = (text: string): string => text.trim()

export const words = (text: string): readonly string[] => headline(text).split(' ')
