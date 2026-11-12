import { RootProvider } from "fumadocs-ui/provider/next"

// Fumadocs' own theme handling is off: the root layout already forces dark.
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <RootProvider theme={{ enabled: false }}>
      <div className="flex min-h-screen flex-col">{children}</div>
    </RootProvider>
  )
}
