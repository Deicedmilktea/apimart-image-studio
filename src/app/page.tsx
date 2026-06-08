import ImageStudio from "@/components/ImageStudio";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-white/10 px-4 py-4">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <span className="text-xl">🎨</span>
          <div>
            <h1 className="text-base font-semibold">APIMart 图片工作室</h1>
            <p className="text-xs text-white/40">
              基于 APIMart GPT-Image-2 的可视化生图
            </p>
          </div>
        </div>
      </header>
      <ImageStudio />
    </main>
  );
}
