import { useState } from 'react';

// קומפוננטה לתמונה עם מצבי טעינה ושגיאה
function StoryImage({ src, alt }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'loaded' | 'error'

  return (
    <div className="mt-3">
      {status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
          <span className="animate-spin text-lg">🎨</span>
          <span>האיור נוצר... זה לוקח עד חצי דקה, אנחנו ממתינים ✨</span>
        </div>
      )}
      {status === 'error' && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm">
          <p className="text-orange-700 font-semibold mb-1">⚠️ האיור לא נטען</p>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800"
          >
            לחץ/י כאן לצפייה באיור בטאב חדש 🔗
          </a>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`rounded-xl max-w-full block transition-opacity duration-300 ${
          status === 'loaded' ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
        }`}
        style={status !== 'loaded' ? { width: 0, height: 0 } : {}}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </div>
  );
}

function renderContent(content) {
  // Parse markdown images: ![alt](url) — supports long data: URLs and https
  const imgRegex = /!\[([^\]]*)\]\((data:[^)]+|https?:\/\/[^\s)]+)\)/g;
  const result = [];
  let lastIndex = 0;
  let match;

  while ((match = imgRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      result.push(content.slice(lastIndex, match.index));
    }
    result.push(
      <StoryImage key={match.index} src={match[2]} alt={match[1]} />
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
