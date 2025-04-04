const fs = require("fs");
const path = require("path");

/**
 * 应用补丁到node-media-server库
 */
function applyPatches() {
  const nodeModulesPath = path.join(process.cwd(), "node_modules");
  const patchesDir = path.join(__dirname);

  // 需要修补的文件列表
  const patchFiles = [
    {
      patch: path.join(patchesDir, "node_trans_server.js"),
      target: path.join(
        nodeModulesPath,
        "node-media-server",
        "src",
        "node_trans_server.js"
      ),
    },
    {
      patch: path.join(patchesDir, "node_core_utils.js"),
      target: path.join(
        nodeModulesPath,
        "node-media-server",
        "src",
        "node_core_utils.js"
      ),
    },
  ];

  // 应用所有补丁
  patchFiles.forEach(({ patch, target }) => {
    try {
      // 检查补丁文件是否存在
      if (fs.existsSync(patch) && fs.existsSync(target)) {
        // 备份原始文件
        const backupFile = `${target}.backup`;
        if (!fs.existsSync(backupFile)) {
          fs.copyFileSync(target, backupFile);
          console.log(`已备份原始文件: ${backupFile}`);
        }

        // 应用补丁
        fs.copyFileSync(patch, target);
        console.log(`已应用补丁: ${path.basename(patch)}`);
      }
    } catch (error) {
      console.error(`应用补丁 ${path.basename(patch)} 失败:`, error);
    }
  });
}

// 导出补丁应用函数
module.exports = applyPatches;
