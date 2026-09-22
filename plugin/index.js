/**
 * The DSH half of euthyna: mounts the packaged skill on `ctx.skills`.
 *
 * The CLI (`bin/euthyna.js`) produces the facts; this plugin is what makes the
 * discipline that consumes them installable with `dsh plugin add euthyna`. It
 * serves the skill directory shipped inside this package, so the bundle carries
 * the skill itself rather than pointing at a checkout.
 *
 * The official filesystem provider is imported instead of reimplemented:
 * frontmatter parsing and root ranking then stay byte-identical with the
 * built-in provider, and the only thing this package decides is which root to
 * serve.
 *
 * @module euthyna/plugin
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';

export const name = 'euthyna';

/** Without the skill registry there is nothing to register onto. */
export const inject = ['skills', 'commands'];

/** This module's directory: `<package>/plugin`, in the repo and in the tarball alike. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The packaged skill root, at the same relative path in both layouts. */
export const SKILLS_ROOT = join(MODULE_DIR, '..', '.agents', 'skills');

/**
 * Register the packaged skill directory as a provider.
 *
 * `includeDefaultRoots: false` keeps this provider to euthyna's own skill: the
 * built-in provider goes on serving the user's other skills, so installing this
 * bundle adds a skill rather than replacing the catalogue. Registration is a
 * plain call — the provider disposes itself through the control signal it is
 * handed.
 *
 * A missing bundle throws rather than mounting an empty provider, because a
 * plugin that installs cleanly and contributes nothing is worse than one that
 * fails where someone can see it.
 *
 * @param ctx - the cordis context, which must expose `skills`.
 * @param config - optional `{ skillsDir }` override for a relocated skill root.
 */
export function apply(ctx, config = {}) {
  const root = resolve(config.skillsDir ?? SKILLS_ROOT);
  const bundle = join(root, 'euthyna', 'SKILL.md');
  if (!existsSync(bundle)) {
    throw new Error(`euthyna: no skill bundle at ${bundle} — set config.skillsDir to the directory holding euthyna/SKILL.md`);
  }
  ctx.skills.registerProvider((control) => new FileSystemSkillProvider(ctx, control, {
    providerName: 'euthyna',
    includeDefaultRoots: false,
    customSkillDirs: [root],
    watch: false,
  }));

  // A DSH slash command is a UI shortcut, not a model prompt: the handler
  // runs and returns text without reaching the model. /euthyna therefore
  // returns the usage manual rather than trying to run an audit itself —
  // the audit itself is triggered by naming the skill in conversation.
  ctx.commands.register({
    name: 'euthyna',
    description: '查看 euthyna 代码安全审计的使用方法',
    handler: () => ({
      kind: 'success',
      text: [
        'euthyna —— 代码安全审计的判定纪律与交付门禁',
        '',
        '怎么触发审计（三选一）：',
        '1. 对话里直接说「用 euthyna 审计 <路径>，审完再交付」',
        '2. 新开会话后在技能列表点 euthyna',
        '3. 本命令只返回说明，不执行审计',
        '',
        'CLI 测量工具（终端里跑）：',
        '  euthyna history  --base <基线> --repo <仓库>   # 删除行归因到提交',
        '  euthyna coverage --coverage <文件> --symbol <符号>',
        '  euthyna deps     --repo <仓库> --dep <包名>',
        '  euthyna gate     <报告.md> [--verify]           # 六门禁机械校验',
        '',
        '退出码：0=干净 / 10=有安全发现 / 1=用法错 / 2=无法测量',
        '报告：<项目>_EUTHYNA_AUDIT_<日期>.md，必须落盘',
      ].join('\n'),
    }),
  });
}
