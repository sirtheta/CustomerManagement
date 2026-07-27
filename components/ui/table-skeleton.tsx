type Props = {
  columns: number;
  rows?: number;
};

export function TableSkeleton({ columns, rows = 8 }: Props) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-t">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <td key={colIdx} className="px-4 py-3">
              <div
                className="h-4 rounded bg-muted animate-pulse"
                style={{ width: colIdx === 0 ? "60%" : colIdx === columns - 1 ? "30%" : "80%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
