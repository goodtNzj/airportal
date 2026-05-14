import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingSkeleton, CardSkeleton } from '../../src/components/LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('should render default 3 lines', () => {
    const { container } = render(<LoadingSkeleton />);
    const lines = container.querySelectorAll('.h-4');
    expect(lines).toHaveLength(3);
  });

  it('should render custom number of lines', () => {
    const { container } = render(<LoadingSkeleton lines={5} />);
    const lines = container.querySelectorAll('.h-4');
    expect(lines).toHaveLength(5);
  });

  it('should have animate-pulse class', () => {
    const { container } = render(<LoadingSkeleton />);
    expect(container.firstChild).toHaveClass('animate-pulse');
  });
});

describe('CardSkeleton', () => {
  it('should render card skeleton', () => {
    const { container } = render(<CardSkeleton />);
    expect(container.firstChild).toHaveClass('animate-pulse');
    expect(container.firstChild).toHaveClass('rounded-2xl');
  });
});
