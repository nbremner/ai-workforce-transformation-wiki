import { registerCondition } from "./quartz/plugins/loader/conditions"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { componentRegistry } from "./quartz/components/registry"

// Path-aware layout condition: the local graph renders only on topic pages.
// Registered before the layout loads so quartz.config.yaml can reference it.
registerCondition("in-topics", (props) => props.fileData.slug?.startsWith("topics/") === true)

// Explorer entries display compact slugs, not full page titles (owner
// preference: slugs are easier to scan, especially for long source titles).
// Registered under both name forms because the generated .quartz/plugins
// helpers store overrides under the escaped directory name while the layout
// builder looks up the raw npm source name. The function is serialized into
// the client bundle, so it must be self-contained.
const explorerOverrides = {
  mapFn: (node: { isFolder: boolean; displayName: string; slugSegment?: string }) => {
    if (!node.isFolder && node.slugSegment) {
      node.displayName = node.slugSegment
    }
  },
}
componentRegistry.setOptionOverrides("@quartz-community/explorer", explorerOverrides)
componentRegistry.setOptionOverrides("quartz-community__explorer", explorerOverrides)

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
