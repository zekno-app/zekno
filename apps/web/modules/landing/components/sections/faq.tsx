import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"

import { faq } from "../../content"
import { Section } from "../ui/section"

export function Faq() {
  const first = faq.items[0]

  return (
    <Section id="faq" className="border-t">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div className="reveal">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {faq.heading}
          </h2>
          <p className="mt-3 text-lg text-pretty text-muted-foreground">{faq.intro}</p>
        </div>
        <Accordion
          defaultValue={first ? [first.id] : []}
          className="reveal border-y"
        >
          {faq.items.map((item) => (
            <AccordionItem key={item.id} value={item.id}>
              <AccordionTrigger className="min-h-14 items-center py-4 text-base">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="max-w-2xl text-base text-pretty text-muted-foreground">
                <p>{item.answer}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  )
}
