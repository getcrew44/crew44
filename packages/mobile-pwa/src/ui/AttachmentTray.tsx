import { MessageAttachment } from "@/api/types";

function extensionForName(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toUpperCase() : "";
}

function displayName(attachment: MessageAttachment): string {
  if (attachment.display_name) return attachment.display_name;
  const parts = attachment.path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || attachment.path || "Attachment";
}

function AttachmentThumb({ attachment }: { attachment: MessageAttachment }) {
  if (attachment.kind === "image" && attachment.thumbnail_jpeg_base64) {
    return <img className="attachment-thumb-image" alt="" src={`data:image/jpeg;base64,${attachment.thumbnail_jpeg_base64}`} />;
  }
  return <span className={`attachment-glyph attachment-${attachment.kind}${attachment.thumbnail_failed ? " attachment-failed" : ""}`} />;
}

export function AttachmentTray({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="attachment-tray">
      {attachments.map(attachment => {
        const name = displayName(attachment);
        return (
          <div className="attachment-chip" key={attachment.path || name}>
            <AttachmentThumb attachment={attachment} />
            <span className="attachment-meta">
              <span className="attachment-name">{name}</span>
              <span className="attachment-kind">{extensionForName(name) || attachment.kind}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
