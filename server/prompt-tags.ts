/** Wraps text in an XML-style tag; a closing tag inside the text is neutralized so data cannot end the block early. */
export function tag(name: string, text: string, attributes: Record<string, string> = {}): string {
  const attrs = Object.entries(attributes).map(([key, value]) => ` ${key}="${value.replaceAll('"', "&quot;")}"`).join("");
  return `<${name}${attrs}>\n${text.replaceAll(`</${name}`, `<\\/${name}`)}\n</${name}>`;
}
