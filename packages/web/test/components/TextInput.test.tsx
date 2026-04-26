import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TextInput } from '../../src/components/TextInput';

describe('TextInput', () => {
  it('should render textarea', () => {
    render(<TextInput onSubmit={vi.fn()} />);

    expect(screen.getByPlaceholderText('输入要发送的文本内容...')).toBeInTheDocument();
  });

  it('should update character count', () => {
    render(<TextInput onSubmit={vi.fn()} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    expect(screen.getByText(/5 \/ 10000 字符/)).toBeInTheDocument();
  });

  it('should call onSubmit when button clicked', () => {
    const handleSubmit = vi.fn();
    render(<TextInput onSubmit={handleSubmit} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello World' } });

    const button = screen.getByRole('button', { name: '发送文本' });
    fireEvent.click(button);

    expect(handleSubmit).toHaveBeenCalledWith('Hello World');
  });

  it('should not submit empty text', () => {
    const handleSubmit = vi.fn();
    render(<TextInput onSubmit={handleSubmit} />);

    const button = screen.getByRole('button', { name: '发送文本' });
    fireEvent.click(button);

    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('should be disabled when loading', () => {
    render(<TextInput onSubmit={vi.fn()} loading />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();

    const button = screen.getByRole('button', { name: '发送中...' });
    expect(button).toBeDisabled();
  });
});
