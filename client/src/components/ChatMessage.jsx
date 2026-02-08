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

        {/* Message content - preserve line breaks */}
        <div className="text-base leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    </div>
  );
}
