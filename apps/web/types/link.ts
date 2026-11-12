/**
 * A labelled destination. An empty `href` means the address is not decided
 * yet: buttons that use it stay on the page without navigating, and lists of
 * links leave it out.
 */
export type Link = {
  label: string
  href: string
  external?: boolean
}
