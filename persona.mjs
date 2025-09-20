import { EmbedBuilder } from 'discord.js';

export function kittenizeTextContent(text, opts = {}) {
  const { addPrefix = true, addSuffix = true } = opts;
  if (typeof text !== 'string' || !text.length) return text;
  let result = text.replace(/<@([0-9]+)>/g, (match, id, offset, str) => {
    const sliceStart = Math.max(0, offset - 7);
    const prefix = str.slice(sliceStart, offset);
    if (/Kitten\s$/i.test(prefix)) return match;
    return `Kitten <@${id}>`;
  });
  const personaTweaks = [
    { regex: /You do not have permission/gi, replace: 'You do not have permission, Kitten' },
    { regex: /You don’t have permission/gi, replace: 'You don’t have permission, Kitten' },
    { regex: /Your request has been submitted/gi, replace: 'Your request is tucked away, Kitten' },
    { regex: /Your request/gi, replace: 'Your request, Kitten' },
    { regex: /Your balance/gi, replace: 'Your balance, Kitten' },
    { regex: /Please wait/gi, replace: 'Please wait for me, Kitten' },
    { regex: /Thank you/gi, replace: 'Thank you, Kitten' },
    { regex: /Hold on/gi, replace: 'Hold on for me, Kitten' },
    { regex: /\bYou\b(?!, Kitten)(?!\s*<@)/g, replace: 'You, Kitten' },
    { regex: /\byou\b(?!, Kitten)(?!\s*<@)/g, replace: 'you, Kitten' },
    { regex: /\bYour\b(?!, Kitten)/g, replace: 'Your, Kitten' },
    { regex: /\byour\b(?!, Kitten)/g, replace: 'your, Kitten' },
    { regex: /\bHouse keeps pot\b/gi, replace: 'The house keeps the pot, Kitten' },
    { regex: /\bHouse keeps your bet\b/gi, replace: 'The house keeps your bet, Kitten' },
    { regex: /\bHouse keeps the pot\b/gi, replace: 'The house keeps the pot, Kitten' },
    { regex: /\bHouse cannot cover\b/gi, replace: 'The house cannot cover it, Kitten' },
    { regex: /\bHouse could not pay out\b/gi, replace: 'The house could not pay out, Kitten' },
    { regex: /\bOnly the original player\b/gi, replace: 'Only the original Kitten' },
    { regex: /Use `\/ridebus` to start a new one\./gi, replace: 'Use `/ridebus` whenever you crave another thrill, Kitten.' },
    { regex: /Use `\/request`/gi, replace: 'Use `/request`, Kitten' },
    { regex: /Use `\/holdem`/gi, replace: 'Use `/holdem`, Kitten' },
    { regex: /\*\*WIN!\*\*/g, replace: '**WIN, Kitten!**' },
    { regex: /\*\*CASH OUT!\*\*/g, replace: '**CASH OUT, Kitten!**' },
    { regex: /\*\*Wrong!\*\*/g, replace: '**Wrong, Kitten!**' },
    { regex: /\*\*LOSS\*\*/g, replace: '**LOSS, Kitten**' },
    { regex: /\bsession expired\b/gi, replace: 'session cooled off, Kitten' },
    { regex: /Server:/gi, replace: 'Server, Kitten:' },
    { regex: /Player:/gi, replace: 'Player, Kitten:' },
    { regex: /Actor:/gi, replace: 'Actor, Kitten:' },
    { regex: /Game Log/gi, replace: 'Game Log, Kitten' },
    { regex: /Cash Log/gi, replace: 'Cash Log, Kitten' },
    { regex: /Game Session End/gi, replace: 'Game Session End, Kitten' },
    { regex: /House Balance/gi, replace: 'House Balance, Kitten' },
    { regex: /House Net/gi, replace: 'House Net, Kitten' }
  ];
  for (const tweak of personaTweaks) {
    result = result.replace(tweak.regex, tweak.replace);
  }
  if (addPrefix && !result.trim().startsWith('💋')) {
    result = `💋 ${result}`;
  }
  const trimmed = result.trim();
  if (addSuffix && !trimmed.includes('\n')) {
    const suffixes = [
      ' Be a good Kitten for me.',
      ' Stay indulgent for me, Kitten.',
      ' Keep purring for me, Kitten.'
    ];
    if (!/(Kitten|darling|sweetheart)[.!?]$/i.test(trimmed)) {
      const base = trimmed.replace(/[.!?]+$/, '');
      const suffix = suffixes[base.length % suffixes.length];
      result = result.replace(trimmed, `${base}${suffix}`);
    }
  }
  return result;
}

export function kittenizeReplyArg(arg) {
  if (typeof arg === 'string') return kittenizeTextContent(arg);
  if (!arg || typeof arg !== 'object') return arg;
  if (Array.isArray(arg)) return arg.map(kittenizeReplyArg);
  const transformEmbed = (embed) => {
    try {
      let data;
      if (embed && typeof embed.toJSON === 'function') data = embed.toJSON();
      else data = JSON.parse(JSON.stringify(embed));
      if (!data || typeof data !== 'object') return embed;

      const transform = (value) => kittenizeTextContent(value, { addPrefix: false, addSuffix: false });
      if (typeof data.title === 'string') data.title = transform(data.title);
      if (typeof data.description === 'string') data.description = transform(data.description);
      if (data.fields && Array.isArray(data.fields)) {
        data.fields = data.fields.map(field => {
          const f = { ...field };
          if (typeof f.value === 'string') f.value = transform(f.value);
          return f;
        });
      }
      if (data.footer?.text) data.footer.text = transform(data.footer.text);
      if (data.author?.name) data.author.name = transform(data.author.name);
      return EmbedBuilder.from(data);
    } catch {
      return embed;
    }
  };
  if (typeof arg.content === 'string') {
    const transformed = kittenizeTextContent(arg.content);
    if (transformed !== arg.content) {
      return { ...arg, content: transformed };
    }
  }
  if (Array.isArray(arg.embeds)) {
    const embeds = arg.embeds.map(transformEmbed);
    return { ...arg, embeds };
  }
  return arg;
}
