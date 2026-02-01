import mongoose from "mongoose";

const TicketCategorySchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    description: { type: String, trim: true },
    template: { type: String, trim: true },
    questions: { type: [String], default: [] }
  },
  { _id: false }
);

const TicketPanelSchema = new mongoose.Schema(
  {
    panelChannelId: { type: String },
    panelMessageId: { type: String },
    panelTitle: { type: String },
    panelDescription: { type: String },
    panelPinned: { type: Boolean, default: false },
    panelColor: { type: String },
    panelFooterText: { type: String },
    panelThumbnailUrl: { type: String },
    panelImageUrl: { type: String },
    panelAuthorName: { type: String },
    panelAuthorIconUrl: { type: String }
  },
  { _id: false }
);

const TicketConfigSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["channel", "thread"],
      default: "thread"
    },
    openChannelId: { type: String },
    categoryChannelId: { type: String },
    formResponseTemplate: { type: String },
    autoClose: {
      enabled: { type: Boolean, default: false },
      afterMinutes: { type: Number, default: 0 },
      reminderMinutes: { type: Number, default: 0 }
    },
    categories: { type: [TicketCategorySchema], default: [] },
    staffRoleIds: { type: [String], default: [] },
    panel: {
      type: TicketPanelSchema,
      default: () => ({})
    }
  },
  { _id: false }
);

const WelcomeConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    channelId: { type: String },
    autoRoleIds: { type: [String], default: [] },
    title: { type: String },
    description: { type: String },
    color: { type: String },
    footerText: { type: String },
    thumbnailUrl: { type: String },
    imageUrl: { type: String },
    authorName: { type: String },
    authorIconUrl: { type: String }
  },
  { _id: false }
);

const ModerationAutomodSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    antiFlood: {
      enabled: { type: Boolean, default: false },
      maxMessages: { type: Number, default: 6 },
      intervalSeconds: { type: Number, default: 8 },
      timeoutMinutes: { type: Number, default: 2 },
      deleteMessages: { type: Boolean, default: true }
    },
    antiSpam: {
      enabled: { type: Boolean, default: false },
      maxDuplicates: { type: Number, default: 3 },
      intervalSeconds: { type: Number, default: 10 },
      timeoutMinutes: { type: Number, default: 2 },
      deleteMessages: { type: Boolean, default: true }
    },
    antiLink: {
      enabled: { type: Boolean, default: false },
      allowedRoleIds: { type: [String], default: [] },
      allowedChannelIds: { type: [String], default: [] },
      timeoutMinutes: { type: Number, default: 0 },
      deleteMessages: { type: Boolean, default: true }
    },
    wordFilter: {
      enabled: { type: Boolean, default: false },
      words: { type: [String], default: [] },
      timeoutMinutes: { type: Number, default: 0 },
      deleteMessages: { type: Boolean, default: true }
    },
    raidDetection: {
      enabled: { type: Boolean, default: false },
      maxJoins: { type: Number, default: 6 },
      intervalSeconds: { type: Number, default: 12 }
    }
  },
  { _id: false }
);

const ModerationConfigSchema = new mongoose.Schema(
  {
    logChannelId: { type: String },
    automod: { type: ModerationAutomodSchema, default: () => ({}) }
  },
  { _id: false }
);

const VerificationConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    channelId: { type: String },
    messageId: { type: String },
    roleId: { type: String },
    removeRoleId: { type: String },
    panel: {
      title: { type: String },
      description: { type: String },
      buttonLabel: { type: String },
      color: { type: String },
      footerText: { type: String }
    },
    captcha: {
      difficulty: {
        type: String,
        enum: ["easy", "medium", "hard"],
        default: "medium"
      }
    }
  },
  { _id: false }
);

const VibeCheckOptionSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    emoji: { type: String, trim: true },
    label: { type: String, trim: true }
  },
  { _id: false }
);

const VibeCheckConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    channelId: { type: String },
    hour: { type: Number, default: 20 }, // UTC
    question: { type: String, trim: true },
    options: {
      type: [VibeCheckOptionSchema],
      default: () => [
        { id: "top", emoji: "😄", label: "Tô no 220v" },
        { id: "deboa", emoji: "🙂", label: "De boa" },
        { id: "cansado", emoji: "😴", label: "Cansado" },
        { id: "estressado", emoji: "😡", label: "Estressado" }
      ]
    }
  },
  { _id: false }
);

const GuildConfigSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    tickets: {
      type: TicketConfigSchema,
      default: () => ({})
    },
    welcome: {
      type: WelcomeConfigSchema,
      default: () => ({})
    },
    moderation: {
      type: ModerationConfigSchema,
      default: () => ({})
    },
    verification: {
      type: VerificationConfigSchema,
      default: () => ({})
    },
    vibeCheck: {
      type: VibeCheckConfigSchema,
      default: () => ({})
    },
    memoryCapsule: {
      enabled: { type: Boolean, default: false },
      channelId: { type: String },
      cadence: { type: String, enum: ["daily", "weekly"], default: "weekly" },
      hour: { type: Number, default: 20 },
      lastPostedAt: { type: Date }
    }
  },
  { timestamps: true, collection: "guildconfigs" }
);

export default mongoose.models.GuildConfigPanelV2 ||
  mongoose.model("GuildConfigPanelV2", GuildConfigSchema);
