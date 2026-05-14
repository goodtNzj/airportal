import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileUploader } from '../../src/components/FileUploader';

describe('FileUploader', () => {
  it('should render upload area', () => {
    render(<FileUploader onUpload={vi.fn()} />);
    expect(screen.getByText(/拖拽文件/)).toBeInTheDocument();
  });

  it('should show loading overlay when loading', () => {
    const { container } = render(<FileUploader onUpload={vi.fn()} loading />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should show error for oversized file', () => {
    const onUpload = vi.fn();
    const { container } = render(<FileUploader onUpload={onUpload} maxSize={10} />);

    const input = container.querySelector('input[type="file"]')!;
    const file = new File(['x'.repeat(100)], 'test.txt');
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(screen.getByText(/大小超过限制/)).toBeInTheDocument();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('should call onUpload for valid file', () => {
    const onUpload = vi.fn();
    const { container } = render(<FileUploader onUpload={onUpload} maxSize={1000} />);

    const input = container.querySelector('input[type="file"]')!;
    const file = new File(['hello'], 'test.txt');
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it('should show max size info', () => {
    render(<FileUploader onUpload={vi.fn()} maxSize={52428800} />);
    expect(screen.getByText(/50MB/)).toBeInTheDocument();
  });
});
