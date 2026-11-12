import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import NextLink from "next/link"

import { a11y } from "@/config/site"
import type { Link } from "@/types/link"

type ButtonVariantProps = NonNullable<Parameters<typeof buttonVariants>[0]>

/**
 * A link from the site's config or a module's content. When the address is
 * not set yet it renders as the same-looking control without a destination,
 * instead of a broken link.
 */
export function ContentLink({
  link,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { link: Link }) {
  if (link.href === "") {
    return (
      <span className={cn(className, "cursor-default")}>
        {children ?? link.label}
        <span className="sr-only"> ({a11y.unresolved})</span>
      </span>
    )
  }

  // A page of this site: navigate without a full reload.
  if (link.href.startsWith("/")) {
    return (
      <NextLink href={link.href} className={className} {...props}>
        {children ?? link.label}
      </NextLink>
    )
  }

  const external = link.external === true

  return (
    <a
      href={link.href}
      className={className}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...props}
    >
      {children ?? link.label}
      {external ? <span className="sr-only"> {a11y.newTab}</span> : null}
    </a>
  )
}

/** A content link styled as a design-system button. */
export function ButtonLink({
  link,
  variant,
  size,
  className,
  children,
}: Pick<ButtonVariantProps, "variant" | "size"> & {
  link: Link
  className?: string
  children?: React.ReactNode
}) {
  return (
    <ContentLink
      link={link}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {children}
    </ContentLink>
  )
}
