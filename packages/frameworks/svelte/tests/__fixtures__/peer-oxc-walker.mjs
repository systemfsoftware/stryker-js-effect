/**
 * @typedef {object} WalkerNode
 * @property {readonly WalkerNode[]} [children] Child nodes the walker descends into.
 */

/**
 * @param {WalkerNode} node Root handed to the walker.
 * @param {{ enter: (node: WalkerNode) => void }} handlers Walker callbacks.
 * @returns {void}
 */
const walkNodes = (node, handlers) => {
  handlers.enter(node)
  const children = node.children ?? []
  children.forEach((child) => walkNodes(child, handlers))
}

/**
 * @param {WalkerNode} node Root handed to the walker.
 * @param {{ enter: (node: WalkerNode) => void }} handlers Walker callbacks.
 * @returns {void}
 */
export const walk = (node, handlers) => {
  walkNodes(node, handlers)
}
