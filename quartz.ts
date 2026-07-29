import { registerCondition } from "./quartz/plugins/loader/conditions"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"

// Path-aware layout condition: the local graph renders only on topic pages.
// Registered before the layout loads so quartz.config.yaml can reference it.
registerCondition("in-topics", (props) => props.fileData.slug?.startsWith("topics/") === true)

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
