export function dateInTimeZone(date = new Date(), timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parseSyncArguments(argumentsList) {
  const options = {
    all: false,
    refresh: false,
    dryRun: false,
    check: false,
    help: false,
    ids: [],
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--all') options.all = true;
    else if (argument === '--refresh') options.refresh = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--check') {
      options.check = true;
      options.dryRun = true;
    } else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--id') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--id requires one or more comma-separated tool IDs');
      options.ids.push(...value.split(',').map((id) => id.trim()).filter(Boolean));
      index += 1;
    } else if (argument.startsWith('--id=')) {
      options.ids.push(...argument.slice(5).split(',').map((id) => id.trim()).filter(Boolean));
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }

  options.ids = [...new Set(options.ids)];
  if (options.all && options.ids.length > 0) throw new Error('--all and --id cannot be combined');
  if ((options.refresh || options.check) && options.ids.length === 0) options.all = true;
  return options;
}

export function shouldFailBrandCheck(options, { changed, inconclusive }) {
  return options.check === true && (changed > 0 || inconclusive > 0);
}

export function selectToolsForSync(tools, options, iconExists) {
  if (options.ids.length > 0) {
    const knownIds = new Set(tools.map((tool) => tool.id));
    const unknownIds = options.ids.filter((id) => !knownIds.has(id));
    if (unknownIds.length > 0) throw new Error(`unknown tool ID(s): ${unknownIds.join(', ')}`);
    const selectedIds = new Set(options.ids);
    return tools.filter((tool) => selectedIds.has(tool.id));
  }
  if (options.all) return [...tools];
  return tools.filter((tool) => !tool.brandIconPath || !iconExists(tool));
}
