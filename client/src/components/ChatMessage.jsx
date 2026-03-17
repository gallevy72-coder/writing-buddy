function renderContent(content) {
  // Parse markdown images: ![alt](url) — supports long data: URLs
  const imgRegex = /!\[([^\]]*)\]\((data:[^)]+|https?:\/\/[^)]+)\)/g;
  const result = [];
  let lastIndex = 0;
  let match;

  while ((match = imgRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      result.push(content.slice(lastIndex, match.index));
    }
    result.push(
      <img
        key={match.index}
        src={match[2]}
        alt={match[1]}
        className="rounded-xl mt-2 max-w-full block"
        loading="lazy"
      />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    result.push(content.slice(lastIndex));
  }

  return result;
}

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`message-enter flex ${isUser ? 'justify-start' : 'justify-end'} mb-4`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${
          isUser
            ? 'bg-blue-100 text-gray-800 rounded-br-sm'
            : 'bg-white border-2 border-buddy-green text-gray-800 rounded-bl-sm'
        }`}
      >
        {/* Role indicator */}
        <div
          className={`text-xs font-bold mb-1 ${
            isUser ? 'text-buddy-blue' : 'text-buddy-green'
          }`}
        >
          {isUser ? '🧒 אני' : '✏️ חבר לכתיבה'}
        </div>

        {/* Message content - preserve line breaks, render images */}
        <div className="text-base leading-relaxed whitespace-pre-wrap">
          {renderContent(message.content)}
        </div>
      </div>
    </div>
  );
}
