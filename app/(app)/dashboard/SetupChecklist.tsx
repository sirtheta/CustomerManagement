import Link from "next/link";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type SetupStep = { label: string; hint?: string; href: string; done: boolean };

/** First-start guide; disappears once every step is done (or when the user has nothing to do). */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  if (steps.length === 0 || steps.every((step) => step.done)) return null;
  const next = steps.find((step) => !step.done);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">So startest du</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2 text-sm">
          {steps.map((step, i) => (
            <li key={step.label} className="flex items-start gap-2">
              {step.done ? (
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-green-600" aria-label="Erledigt" />
              ) : (
                <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Offen" />
              )}
              <span className={step.done ? "text-muted-foreground line-through" : undefined}>
                {i + 1}.{" "}
                {step.done ? (
                  step.label
                ) : (
                  <Link
                    href={step.href}
                    className={step === next ? "font-medium underline" : "underline"}
                  >
                    {step.label}
                  </Link>
                )}
                {!step.done && step.hint && (
                  <span className="block text-xs text-muted-foreground">{step.hint}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
