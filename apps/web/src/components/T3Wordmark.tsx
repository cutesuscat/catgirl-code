import type { SVGProps } from "react";

/** The app's small mark: the cat head from the Catgirl Code icon. Keeps upstream's name so its uses need no change. */
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="113 91 286 310" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M 126.04,232.73 L 154.09,103.79 Q 156.00,95.00 163.87,99.37 L 222.92,132.18 Z M 385.96,232.73 L 357.91,103.79 Q 356.00,95.00 348.13,99.37 L 289.08,132.18 Z"
        fill="currentColor"
      />
      <circle cx="256" cy="261" r="133" fill="currentColor" />
    </svg>
  );
}
