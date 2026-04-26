import React, { useState, useRef, useEffect } from 'react';

interface CodeInputProps {
  length?: number;
  onSubmit: (code: string) => void;
  loading?: boolean;
}

export function CodeInput({ length = 6, onSubmit, loading }: CodeInputProps) {
  const [code, setCode] = useState<string[]>(Array(length).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    const upperValue = value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');

    if (upperValue) {
      const newCode = [...code];
      newCode[index] = upperValue.slice(-1);
      setCode(newCode);

      // 自动跳转到下一个输入框
      if (index < length - 1 && upperValue) {
        inputRefs.current[index + 1]?.focus();
      }

      // 自动提交
      if (newCode.every((c) => c) && newCode.join('').length === length) {
        onSubmit(newCode.join(''));
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '');
    const newCode = code.map((_, i) => pastedData[i] || '');
    setCode(newCode);
    if (pastedData.length >= length) {
      onSubmit(pastedData.slice(0, length));
    }
  };

  return (
    <div className="flex justify-center gap-2">
      {code.map((char, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          value={char}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          className="w-12 h-14 text-center text-xl font-bold border-2 border-slate-200 rounded-lg focus:border-primary-500 focus:outline-none transition-colors uppercase"
          maxLength={1}
          disabled={loading}
        />
      ))}
    </div>
  );
}
