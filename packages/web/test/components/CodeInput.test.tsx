import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeInput } from '../../src/components/CodeInput';

describe('CodeInput', () => {
  it('should render 6 input fields', () => {
    render(<CodeInput onSubmit={vi.fn()} />);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(6);
  });

  it('should accept valid characters', () => {
    render(<CodeInput onSubmit={vi.fn()} />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'A' } });

    expect(inputs[0]).toHaveValue('A');
  });

  it('should reject invalid characters (0, O, I, l, 1)', () => {
    render(<CodeInput onSubmit={vi.fn()} />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: '0' } });

    // 0 应该被过滤掉
    expect(inputs[0]).toHaveValue('');
  });

  it('should be disabled when loading', () => {
    render(<CodeInput onSubmit={vi.fn()} loading />);

    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input) => {
      expect(input).toBeDisabled();
    });
  });

  it('should handle paste with valid code', () => {
    const handleSubmit = vi.fn();
    render(<CodeInput onSubmit={handleSubmit} />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.paste(inputs[0], {
      clipboardData: {
        getData: () => 'ABCDEF',
      },
    });

    expect(handleSubmit).toHaveBeenCalledWith('ABCDEF');
  });

  it('should filter paste to only valid characters', () => {
    const handleSubmit = vi.fn();
    render(<CodeInput onSubmit={handleSubmit} />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.paste(inputs[0], {
      clipboardData: {
        getData: () => 'A0B1C2', // 包含无效字符 0 和 1
      },
    });

    // 无效字符应该被过滤，只有 6 个有效字符才会触发提交
    // A0B1C2 过滤后是 ABC2，只有 4 个字符，不会触发提交
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
