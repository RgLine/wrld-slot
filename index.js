require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const Database = require('better-sqlite3');
const { createCanvas, loadImage } = require('canvas');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DEFAULT_PREFIX = 'wrld'; // Default prefix

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const db = new Database('economy.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wrldcash INTEGER DEFAULT 50000,
  wrldcf INTEGER DEFAULT 0,
  last_daily INTEGER DEFAULT 0,
  daily_streak INTEGER DEFAULT 0,
  weapon_crates INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  xp_next INTEGER DEFAULT 14604,
  rank_num INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS blocked_channels (
  channel_id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS guild_prefixes (
  guild_id TEXT PRIMARY KEY,
  prefix TEXT NOT NULL
);
`);

function getPrefix(guildId) {
  const row = db.prepare('SELECT prefix FROM guild_prefixes WHERE guild_id = ?').get(guildId);
  return row ? row.prefix : DEFAULT_PREFIX;
}

function isChannelBlocked(channelId) {
  const row = db.prepare('SELECT 1 FROM blocked_channels WHERE channel_id = ?').get(channelId);
  return !!row;
}

function getUser(userId) {
  let user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    db.prepare(`INSERT INTO users (id, wrldcash, wrldcf, last_daily, daily_streak, weapon_crates, level, xp, xp_next, rank_num)
      VALUES (?, 50000, 0, 0, 0, 0, 1, 0, 14604, 0)`).run(userId);
    return { id: userId, wrldcash:50000, wrldcf:0, last_daily:0, daily_streak:0, weapon_crates:0, level:1, xp:0, xp_next:14604, rank_num:0 };
  }
  return user;
}

function addXP(userId, amount = 8) {
  const u = getUser(userId);
  let newXP = u.xp + amount;
  let newLevel = u.level;
  let newXpNext = u.xp_next;
  while (newXP >= newXpNext) {
    newXP -= newXpNext;
    newLevel += 1;
    newXpNext = Math.round(newXpNext * 1.22);
  }
  db.prepare(`UPDATE users SET xp = ?, level = ?, xp_next = ? WHERE id = ?`)
    .run(newXP, newLevel, newXpNext, userId);
}

async function createProfileCard(user, data) {
  const cv = createCanvas(920, 330);
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,920,330);
  grad.addColorStop(0, '#2b1b47');
  grad.addColorStop(1, '#483480');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,920,330);

  ctx.strokeStyle = '#9988dd';
  ctx.lineWidth = 4;
  ctx.strokeRect(12,12,896,306);

  const avatar = await loadImage(user.displayAvatarURL({extension:'png',size:256}));
  ctx.save();
  ctx.beginPath();
  ctx.arc(130,150,82,0,Math.PI*2);
  ctx.clip();
  ctx.drawImage(avatar,48,68,164,164);
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px Arial';
  ctx.fillText(user.username, 275, 100);

  ctx.font = '22px Arial';
  ctx.fillStyle = '#ccccff';
  ctx.fillText('WRLD Bot User', 275, 142);

  ctx.font = 'bold 30px Arial';
  ctx.fillText(`Level: ${data.level}`, 275, 200);
  ctx.fillText(`Rank: #${(data.rank_num || Math.floor(Math.random()*999999)).toLocaleString()}`, 275, 240);

  const percent = data.xp / data.xp_next;
  ctx.fillStyle = '#444466';
  ctx.fillRect(275,272,560,22);
  ctx.fillStyle = '#7289da';
  ctx.fillRect(275,272,560*percent,22);

  ctx.font = '18px Arial';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${data.xp.toLocaleString()} / ${data.xp_next.toLocaleString()} XP`, 450, 306);

  return new AttachmentBuilder(cv.toBuffer(), {name:'profile.png'});
}

const symbols = ['🍋', '🍊', '🍒', '🍇', '🔔', '💎', '7️⃣'];
const payouts = {
  '🍒🍒🍒': 2,
  '🍊🍊🍊': 5,
  '🍋🍋🍋': 7,
  '🍇🍇🍇': 12,
  '🔔🔔🔔': 25,
  '💎💎💎': 50,
  '7️⃣7️⃣7️⃣': 100
};

const commands = [
  new SlashCommandBuilder().setName('help').setDescription('Display all bot commands'),
  new SlashCommandBuilder().setName('setprefix').setDescription('Change the server command prefix (admin only)')
    .addStringOption(opt => opt.setName('prefix').setDescription('New prefix, max 10 characters').setRequired(true)),
  new SlashCommandBuilder().setName('balance').setDescription('Check your WRLD Balance'),
  new SlashCommandBuilder().setName('profile').setDescription('View user profile')
    .addUserOption(opt => opt.setName('user').setDescription('Select a user').setRequired(false)),
  new SlashCommandBuilder().setName('level').setDescription('View user level and XP')
    .addUserOption(opt => opt.setName('user').setDescription('Select a user').setRequired(false)),
  new SlashCommandBuilder().setName('give').setDescription('Send balance to another user')
    .addUserOption(opt => opt.setName('recipient').setDescription('User to receive balance').setRequired(true))
    .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of WRLD Balance').setRequired(true)),
  new SlashCommandBuilder().setName('slot').setDescription('Play the slot machine')
    .addStringOption(opt => opt.setName('bet').setDescription('Amount or "all"').setRequired(true)),
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin')
    .addStringOption(opt => opt.setName('bet').setDescription('Amount or "all"').setRequired(true))
    .addStringOption(opt => opt.setName('choice').setDescription('h = Heads / t = Tails').setRequired(false)),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),
  new SlashCommandBuilder().setName('crate').setDescription('Open a weapon crate'),
  new SlashCommandBuilder().setName('blockchannel').setDescription('Disable commands in this channel (admin only)'),
  new SlashCommandBuilder().setName('allowchannel').setDescription('Re-enable commands in this channel (admin only)')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Successfully registered all slash commands!');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();

function showCommandList(prefix = DEFAULT_PREFIX) {
  return new EmbedBuilder()
    .setTitle('📋 Daftar Perintah Bot WRLD')
    .setColor('#483480')
    .setDescription(`
**Perintah menggunakan awalan \`${prefix}\`:**
💰 **Keuangan & Saldo**
\`${prefix}balance / ${prefix}cash\` → Cek saldo WRLD kamu
\`${prefix}daily\` → Ambil hadiah harian
\`${prefix}give @pengguna <jumlah>\` → Kirim saldo ke orang lain
🎮 **Permainan**
\`${prefix}slot, ${prefix}s <jumlah/semua>\` → Main mesin slot
\`${prefix}coinflip <amount/all> [h/t]\` → Lempar koin, tebak kepala/ekor
\`${prefix}crate\` → Buka peti senjata
📊 **Profil & Tingkat**
\`${prefix}profile [@pengguna]\` → Lihat profil lengkap
\`${prefix}level [@pengguna]\` → Lihat tingkat & poin pengalaman
ℹ️ **Bantuan**
\`${prefix}help\` → Tampilkan daftar perintah ini
⚙️ **Pengaturan Server (Hanya Admin)**
\`${prefix}setprefix <teks>\` → Ubah awalan perintah
\`${prefix}blockchannel\` → Matikan perintah di saluran ini
\`${prefix}allowchannel\` → Nyalakan kembali perintah
    `)
    .setFooter({ text: `Awalan saat ini: ${prefix} | Kamu juga bisa gunakan perintah garis miring /` });
}

client.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;
  const prefix = getPrefix(msg.guild.id);
  addXP(msg.author.id, 8);

  if (!msg.content.startsWith(prefix)) return;
  const args = msg.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (isChannelBlocked(msg.channel.id) && !['allowchannel', 'help', 'setprefix'].includes(cmd)) return;

  if (cmd === 'help') {
    return msg.reply({ embeds: [showCommandList(prefix)] });
  }

// Perintah khusus pemilik: Atur saldo pengguna
if (cmd === 'setsaldo' || cmd === 'addsaldo') {
  // Ganti dengan ID akun Discord kamu sendiri
  const OWNER_ID = '548006103003168768';
  if (msg.author.id !== OWNER_ID) 
    return msg.reply('❌ Perintah ini hanya untuk pemilik bot!');

  const target = msg.mentions.users.first() || msg.author;
  const jumlah = parseInt(args[1]);

  if (isNaN(jumlah) || jumlah < 0)
    return msg.reply(`⚠️ Contoh penggunaan: \`${prefix}setsaldo @pengguna 999999\` atau \`${prefix}setsaldo 500000\``);

  // Update saldo di database
  db.prepare(`UPDATE users SET wrldcash = ? WHERE id = ?`)
    .run(jumlah, target.id);

  // Ambil data terbaru untuk konfirmasi
  const dataBaru = getUser(target.id);
  return msg.reply(`✅ Saldo **${target.username}** berhasil diatur menjadi: **${dataBaru.wrldcash.toLocaleString()} WRLD Balance**`);
}

  if (cmd === 'setprefix') {
    if (!msg.member.permissions.has(PermissionFlagsBits.ManageGuild))
      return msg.reply('❌ Only server managers can change the prefix!');
    const newPrefix = args[0];
    if (!newPrefix || newPrefix.length > 10)
      return msg.reply('❌ Please enter a valid prefix, max 10 characters!');
    db.prepare('REPLACE INTO guild_prefixes (guild_id, prefix) VALUES (?, ?)').run(msg.guild.id, newPrefix);
    return msg.reply(`✅ Prefix successfully changed to: \`${newPrefix}\``);
  }

  if (cmd === 'blockchannel') {
    if (!msg.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return msg.reply('❌ Only administrators can use this command!');
    db.prepare('INSERT OR IGNORE INTO blocked_channels (channel_id) VALUES (?)').run(msg.channel.id);
    return msg.reply(`✅ Bot commands disabled in this channel — except \`${prefix}help\` and \`${prefix}allowchannel\`.`);
  }

  if (cmd === 'allowchannel') {
    if (!msg.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return msg.reply('❌ Only administrators can use this command!');
    db.prepare('DELETE FROM blocked_channels WHERE channel_id = ?').run(msg.channel.id);
    return msg.reply('✅ Bot commands fully re-enabled in this channel.');
  }

  if (cmd === 'balance' || cmd === 'cash') {
    const u = getUser(msg.author.id);
    return msg.reply(`🔹 | ${msg.author}, your balance: **${u.wrldcash.toLocaleString()} WRLD Balance**`);
  }

  if (cmd === 'give') {
    const recipient = msg.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!recipient) return msg.reply(`⚠️ Usage: \`${prefix}give @user <amount>\``);
    if (recipient.bot || recipient.id === msg.author.id) return msg.reply('❌ You cannot send balance to bots or yourself!');
    if (isNaN(amount) || amount < 1) return msg.reply('❌ Invalid amount!');
    const sender = getUser(msg.author.id);
    if (sender.wrldcash < amount) return msg.reply('❌ Not enough WRLD Balance!');

    const confirmRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder().setCustomId('confirm_send').setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cancel_send').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
      );

    const confirmMsg = await msg.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('⚠️ Confirm Transfer')
          .setDescription(`You are about to send **${amount.toLocaleString()} WRLD Balance** to ${recipient}\n\n⚠️ Do not exchange in-game currency for real money.`)
          .setColor('#f9a825')
      ],
      components: [confirmRow]
    });

    const collector = confirmMsg.createMessageComponentCollector({ time: 30000 });
    collector.on('collect', async interaction => {
      if (interaction.user.id !== msg.author.id) return interaction.reply({ content: '❌ This is not your transaction!', ephemeral: true });
      if (interaction.customId === 'confirm_send') {
        db.prepare('UPDATE users SET wrldcash = wrldcash - ? WHERE id = ?').run(amount, msg.author.id);
        getUser(recipient.id);
        db.prepare('UPDATE users SET wrldcash = wrldcash + ? WHERE id = ?').run(amount, recipient.id);
        await interaction.update({
          embeds: [new EmbedBuilder().setTitle('✅ Transfer Successful').setDescription(`Successfully sent **${amount.toLocaleString()} WRLD Balance** to ${recipient}`).setColor('#2ecc71')],
          components: []
        });
        collector.stop();
      } else {
        await interaction.update({
          embeds: [new EmbedBuilder().setTitle('❌ Cancelled').setDescription('Transfer has been cancelled.').setColor('#e74c3c')],
          components: []
        });
        collector.stop();
      }
    });
    collector.on('end', (_, reason) => {
      if (reason === 'time') {
        confirmMsg.edit({
          embeds: [new EmbedBuilder().setTitle('⏳ Time Expired').setDescription('No confirmation received within 30 seconds, transfer cancelled.').setColor('#999999')],
          components: []
        }).catch(() => {});
      }
    });
  }

  if (cmd === 'coinflip' || cmd === 'cf') {
    const u = getUser(msg.author.id);
    const betInput = args[0]?.toLowerCase();
    let choice = args[1]?.toLowerCase();
    if (!betInput) return msg.reply(`⚠️ Usage: \`${prefix}coinflip <amount/all> [h/t]\``);
    let bet = betInput === 'all' ? u.wrldcash : parseInt(betInput);
    if (isNaN(bet) || bet < 1 || bet > u.wrldcash) return msg.reply('❌ Invalid bet amount or insufficient balance!');
    choice = ['h','t','heads','tails'].includes(choice) ? choice : Math.random() < 0.5 ? 'h' : 't';
    const result = Math.random() < 0.5 ? 'h' : 't';
    const won = (['h','heads'].includes(choice) && result === 'h') || (['t','tails'].includes(choice) && result === 't');
    if (won) {
      db.prepare('UPDATE users SET wrldcash = wrldcash + ? WHERE id = ?').run(bet, msg.author.id);
      return msg.reply(`${msg.author} placed a bet of 🟦 ${bet.toLocaleString()} WRLD Balance and chose ${choice === 'h' ? 'Heads' : 'Tails'}\nThe coin flips... 🟡 and you win 🟦 ${(bet * 2).toLocaleString()} WRLD Balance!`);
    } else {
      db.prepare('UPDATE users SET wrldcash = wrldcash - ? WHERE id = ?').run(bet, msg.author.id);
      return msg.reply(`${msg.author} placed a bet of 🟦 ${bet.toLocaleString()} WRLD Balance and chose ${choice === 'h' ? 'Heads' : 'Tails'}\nThe coin flips... 🟡 and you lose this round... :c`);
    }
  }

  if (cmd === 'daily') {
    const u = getUser(msg.author.id);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    if (now - u.last_daily < oneDay) {
      const remainingHours = Math.floor((oneDay - (now - u.last_daily)) / 3600000);
      const remainingMins = Math.floor(((oneDay - (now - u.last_daily)) % 3600000) / 60000);
      return msg.reply(`⏰ Next daily reward available in: **${remainingHours}h ${remainingMins}m**`);
    }
    const streak = (now - u.last_daily < oneDay * 2) ? u.daily_streak + 1 : 1;
    const reward = 1000000;
    const getCrate = Math.random() < 0.3 ? 1 : 0;
    db.prepare(`UPDATE users 
      SET wrldcash = wrldcash + ?, daily_streak = ?, last_daily = ?, weapon_crates = weapon_crates + ? 
      WHERE id = ?`)
      .run(reward, streak, now, getCrate, msg.author.id);
    const embed = new EmbedBuilder()
      .setDescription(`💰 Here's your daily reward 🟦 **${reward.toLocaleString()} WRLD Balance!**\n🔁 Current streak: **${streak} days!**`);
    if (getCrate) embed.addFields({ name: '📦 Weapon Crate', value: 'You received 1 weapon crate!' });
    return msg.reply({ embeds: [embed] });
  }

  if (cmd === 'crate') {
    const u = getUser(msg.author.id);
    if (u.weapon_crates < 1) return msg.reply('❌ You have no weapon crates!');
    db.prepare('UPDATE users SET weapon_crates = weapon_crates - 1 WHERE id = ?').run(msg.author.id);
    const weapons = ['🔪 Sharp Knife', '🔫 Light Rifle', '🛡️ Strong Shield', '⚔️ Legendary Sword'];
    const reward = weapons[Math.floor(Math.random() * weapons.length)];
    return msg.reply(`📦 Opening crate...\n🎉 You received: **${reward}**`);
  }

  if (cmd === 'slot' || cmd === 's') {
    const u = getUser(msg.author.id);
    const betInput = args[0]?.toLowerCase();
    if (!betInput) return msg.reply(`⚠️ Usage: \`${prefix}slot <amount/all>\``);
    let bet = betInput === 'all' ? u.wrldcash : parseInt(betInput);
    if (isNaN(bet) || bet < 1 || bet > u.wrldcash) return msg.reply('❌ Invalid bet amount or insufficient balance!');
    db.prepare('UPDATE users SET wrldcash = wrldcash - ? WHERE id = ?').run(bet, msg.author.id);

    const chance = Math.random();
    let r1, r2, r3;
    if (chance < 0.35) {
      const type = Math.random();
      if (type < 0.4) r1=r2=r3='🍒';
      else if (type < 0.65) r1=r2=r3='🍊';
      else if (type < 0.85) r1=r2=r3='🍋';
      else r1=r2=r3='🍇';
    } else if (chance < 0.45) {
      const type = Math.random();
      if (type < 0.6) r1=r2=r3='🔔';
      else if (type < 0.9) r1=r2=r3='💎';
      else r1=r2=r3='7️⃣';
    } else {
      r1 = symbols[Math.floor(Math.random() * symbols.length)];
      r2 = symbols[Math.floor(Math.random() * symbols.length)];
      r3 = symbols[Math.floor(Math.random() * symbols.length)];
    }

    const result = r1 + r2 + r3;
    const winAmount = payouts[result] ? bet * payouts[result] : 0;
    if (winAmount > 0) {
      db.prepare('UPDATE users SET wrldcash = wrldcash + ? WHERE id = ?').run(winAmount, msg.author.id);
    }

    const slotMsg = await msg.reply({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| 🎰 | 🎰 | 🎰 |\n🔄 Spinning...`).setColor('#999999')] });
    setTimeout(() => slotMsg.edit({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| ${r1} | 🎰 | 🎰 |`).setColor('#999999')] }), 800);
    setTimeout(() => slotMsg.edit({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| ${r1} | ${r2} | 🎰 |`).setColor('#999999')] }), 1600);
    setTimeout(() => slotMsg.edit({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| ${r1} | ${r2} | ${r3} |\n\n${winAmount>0 ? `🎉 Won: +${winAmount.toLocaleString()} WRLD Balance` : `😞 Lost: -${bet.toLocaleString()} WRLD Balance`}`).setColor(winAmount>0 ? '#2ecc71' : '#e74c3c')] }), 2400);
  }

  if (cmd === 'profile') {
    const target = msg.mentions.users.first() || msg.author;
    const data = getUser(target.id);
    const card = await createProfileCard(target, data);
    return msg.reply({ files: [card] });
  }

  if (cmd === 'level') {
    const target = msg.mentions.users.first() || msg.author;
    const data = getUser(target.id);
    const embed = new EmbedBuilder()
      .setAuthor({name: target.username, iconURL: target.displayAvatarURL()})
      .setTitle('📊 Level Information')
      .setColor('#483480')
      .setDescription(`
Level: **${data.level}**
Rank: **#${(data.rank_num || Math.floor(Math.random()*999999)).toLocaleString()}**
XP: **${data.xp.toLocaleString()} / ${data.xp_next.toLocaleString()}**
Balance: **${data.wrldcash.toLocaleString()} WRLD Balance**
      `);
    return msg.reply({embeds:[embed]});
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const prefix = interaction.guild ? getPrefix(interaction.guild.id) : DEFAULT_PREFIX;
  if (isChannelBlocked(interaction.channel.id) && !['allowchannel','help','setprefix'].includes(interaction.commandName))
    return interaction.reply({content: '❌ Commands are disabled in this channel.', ephemeral: true});

  const cmd = interaction.commandName;
  const user = interaction.user;
  addXP(user.id, 12);

  try {
    if (cmd === 'help') {
      return interaction.reply({ embeds: [showCommandList(prefix)] });
    }

    if (cmd === 'setprefix') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))
        return interaction.reply({content: '❌ Only server managers can change the prefix!', ephemeral:true});
      const newPrefix = interaction.options.getString('prefix');
      if (!newPrefix || newPrefix.length > 10)
        return interaction.reply({content: '❌ Please enter a valid prefix, max 10 characters!', ephemeral:true});
      db.prepare('REPLACE INTO guild_prefixes (guild_id, prefix) VALUES (?, ?)').run(interaction.guild.id, newPrefix);
      return interaction.reply(`✅ Prefix successfully changed to: \`${newPrefix}\``);
    }

    if (cmd === 'blockchannel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
        return interaction.reply({content: '❌ Only administrators can use this command!', ephemeral:true});
      db.prepare('INSERT OR IGNORE INTO blocked_channels (channel_id) VALUES (?)').run(interaction.channel.id);
      return interaction.reply('✅ Bot commands disabled in this channel — except `/help` and `/allowchannel`.');
    }

    if (cmd === 'allowchannel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
        return interaction.reply({content: '❌ Only administrators can use this command!', ephemeral:true});
      db.prepare('DELETE FROM blocked_channels WHERE channel_id = ?').run(interaction.channel.id);
      return interaction.reply('✅ Bot commands fully re-enabled in this channel.');
    }

    if (cmd === 'profile') {
      const target = interaction.options.getUser('user') || user;
      const data = getUser(target.id);
      const card = await createProfileCard(target, data);
      return interaction.reply({ files: [card] });
    }

    if (cmd === 'level') {
      const target = interaction.options.getUser('user') || user;
      const data = getUser(target.id);
      const embed = new EmbedBuilder()
        .setAuthor({name: target.username, iconURL: target.displayAvatarURL()})
        .setTitle('📊 Level Information')
        .setColor('#483480')
        .setDescription(`
Level: **${data.level}**
Rank: **#${(data.rank_num || Math.floor(Math.random()*999999)).toLocaleString()}**
XP: **${data.xp.toLocaleString()} / ${data.xp_next.toLocaleString()}**
Balance: **${data.wrldcash.toLocaleString()} WRLD Balance**
        `);
      return interaction.reply({embeds:[embed]});
    }

    if (cmd === 'balance') {
      const u = getUser(user.id);
      return interaction.reply(`🔹 Your balance: **${u.wrldcash.toLocaleString()} WRLD Balance**`);
    }

    if (cmd === 'give') {
      const recipient = interaction.options.getUser('recipient');
      const amount = interaction.options.getInteger('amount');
      if (recipient.bot || recipient.id === user.id) return interaction.reply({content: '❌ You cannot send balance to bots or yourself!', ephemeral:true});
      const senderData = getUser(user.id);
      if (senderData.wrldcash < amount) return interaction.reply({content: '❌ Not enough WRLD Balance!', ephemeral:true});

      const confirmRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('confirm_send').setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('cancel_send').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
        );

      const msg = await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('⚠️ Confirm Transfer')
            .setDescription(`You are about to send **${amount.toLocaleString()} WRLD Balance** to ${recipient}\n\n⚠️ Do not exchange in-game currency for real money.`)
            .setColor('#f9a825')
        ],
        components: [confirmRow],
        fetchReply: true
      });

      const collector = msg.createMessageComponentCollector({ time: 30000 });
      collector.on('collect', async btn => {
        if (btn.user.id !== user.id) return btn.reply({content: '❌ This is not your transaction!', ephemeral:true});
        if (btn.customId === 'confirm_send') {
          db.prepare('UPDATE users SET wrldcash = wrldcash - ? WHERE id = ?').run(amount, user.id);
          getUser(recipient.id);
          db.prepare('UPDATE users SET wrldcash = wrldcash + ? WHERE id = ?').run(amount, recipient.id);
          await btn.update({
            embeds: [new EmbedBuilder().setTitle('✅ Transfer Successful').setDescription(`Successfully sent **${amount.toLocaleString()} WRLD Balance** to ${recipient}`).setColor('#2ecc71')],
            components: []
          });
        } else {
          await btn.update({
            embeds: [new EmbedBuilder().setTitle('❌ Cancelled').setDescription('Transfer has been cancelled.').setColor('#e74c3c')],
            components: []
          });
        }
        collector.stop();
      });
    }

    if (cmd === 'slot') {
      const u = getUser(user.id);
      const betInput = interaction.options.getString('bet').toLowerCase();
      let bet = betInput === 'all' ? u.wrldcash : parseInt(betInput);
      if (isNaN(bet) || bet < 1 || bet > u.wrldcash) return interaction.reply({content: '❌ Invalid bet amount or insufficient balance!', ephemeral:true});
      db.prepare('UPDATE users SET wrldcash = wrldcash - ? WHERE id = ?').run(bet, user.id);

      const chance = Math.random();
      let r1, r2, r3;
      if (chance < 0.35) {
        const type = Math.random();
        if (type < 0.4) r1=r2=r3='🍒';
        else if (type < 0.65) r1=r2=r3='🍊';
        else if (type < 0.85) r1=r2=r3='🍋';
        else r1=r2=r3='🍇';
      } else if (chance < 0.45) {
        const type = Math.random();
        if (type < 0.6) r1=r2=r3='🔔';
        else if (type < 0.9) r1=r2=r3='💎';
        else r1=r2=r3='7️⃣';
      } else {
        r1 = symbols[Math.floor(Math.random() * symbols.length)];
        r2 = symbols[Math.floor(Math.random() * symbols.length)];
        r3 = symbols[Math.floor(Math.random() * symbols.length)];
      }

      const result = r1 + r2 + r3;
      const winAmount = payouts[result] ? bet * payouts[result] : 0;
      if (winAmount > 0) db.prepare('UPDATE users SET wrldcash = wrldcash + ? WHERE id = ?').run(winAmount, user.id);

      const reply = await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| 🎰 | 🎰 | 🎰 |\n🔄 Spinning...`).setColor('#999999')], fetchReply:true });
      setTimeout(() => reply.edit({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| ${r1} | 🎰 | 🎰 |`).setColor('#999999')] }), 800);
      setTimeout(() => reply.edit({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| ${r1} | ${r2} | 🎰 |`).setColor('#999999')] }), 1600);
      setTimeout(() => reply.edit({ embeds: [new EmbedBuilder().setTitle('🎰 WRLD SLOT').setDescription(`| ${r1} | ${r2} | ${r3} |\n\n${winAmount>0 ? `🎉 Won: +${winAmount.toLocaleString()} WRLD Balance` : `😞 Lost: -${bet.toLocaleString()} WRLD Balance`}`).setColor(winAmount>0 ? '#2ecc71' : '#e74c3c')] }), 2400);
    }

    if (cmd === 'coinflip') {
      const u = getUser(user.id);
      const betInput = interaction.options.getString('bet').toLowerCase();
      const choice = interaction.options.getString('choice')?.toLowerCase() || Math.random() < 0.5 ? 'h' : 't';
      let bet = betInput === 'all' ? u.wrldcash : parseInt(betInput);
      if (isNaN(bet) || bet < 1 || bet > u.wrldcash) return interaction.reply({content: '❌ Invalid bet amount or insufficient balance!', ephemeral:true});
      const result = Math.random() < 0.5 ? 'h' : 't';
      const won = (['h','heads'].includes(choice) && result === 'h') || (['t','tails'].includes(choice) && result === 't');
      if (won) {
        db.prepare('UPDATE users SET wrldcash = wrldcash + ? WHERE id = ?').run(bet, user.id);
        return interaction.reply(`${user} placed a bet of 🟦 ${bet.toLocaleString()} WRLD Balance and chose ${choice === 'h' ? 'Heads' : 'Tails'}\nThe coin flips... 🟡 and you win 🟦 ${(bet * 2).toLocaleString()} WRLD Balance!`);
      } else {
        db.prepare('UPDATE users SET wrldcash = wrldcash - ? WHERE id = ?').run(bet, user.id);
        return interaction.reply(`${user} placed a bet of 🟦 ${bet.toLocaleString()} WRLD Balance and chose ${choice === 'h' ? 'Heads' : 'Tails'}\nThe coin flips... 🟡 and you lose this round... :c`);
      }
    }

    if (cmd === 'daily') {
      const u = getUser(user.id);
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      if (now - u.last_daily < oneDay) {
        const remainingHours = Math.floor((oneDay - (now - u.last_daily)) / 3600000);
        const remainingMins = Math.floor(((oneDay - (now - u.last_daily)) % 3600000) / 60000);
        return interaction.reply(`⏰ Next daily reward available in: **${remainingHours}h ${remainingMins}m**`);
      }
      const streak = (now - u.last_daily < oneDay * 2) ? u.daily_streak + 1 : 1;
      const reward = 1000000;
      const getCrate = Math.random() < 0.3 ? 1 : 0;
      db.prepare(`UPDATE users 
        SET wrldcash = wrldcash + ?, daily_streak = ?, last_daily = ?, weapon_crates = weapon_crates + ? 
        WHERE id = ?`)
        .run(reward, streak, now, getCrate, user.id);
      const embed = new EmbedBuilder()
        .setDescription(`💰 Here's your daily reward 🟦 **${reward.toLocaleString()} WRLD Balance!**\n🔁 Current streak: **${streak} days!**`);
      if (getCrate) embed.addFields({ name: '📦 Weapon Crate', value: 'You received 1 weapon crate!' });
      return interaction.reply({ embeds: [embed] });
    }

    if (cmd === 'crate') {
      const u = getUser(user.id);
      if (u.weapon_crates < 1) return interaction.reply({content: '❌ You have no weapon crates!', ephemeral:true});
      db.prepare('UPDATE users SET weapon_crates = weapon_crates - 1 WHERE id = ?').run(user.id);
      const weapons = ['🔪 Sharp Knife', '🔫 Light Rifle', '🛡️ Strong Shield', '⚔️ Legendary Sword'];
      const reward = weapons[Math.floor(Math.random() * weapons.length)];
      return interaction.reply(`📦 Opening crate...\n🎉 You received: **${reward}**`);
    }

  } catch (err) {
    console.error('Command error:', err);
    return interaction.reply({ content: '❌ An error occurred while executing this command.', ephemeral: true });
  }
});

client.on('ready', () => console.log(`✅ Bot online: ${client.user.tag} | Default prefix: ${DEFAULT_PREFIX}`));
client.login(TOKEN);
