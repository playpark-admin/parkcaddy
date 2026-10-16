import com.sun.source.util.JavacTask;
import javax.tools.*;
import java.nio.file.*;
import java.io.*;
import java.util.*;

/** Parses only; this is deliberately NOT Android type checking or an APK build. */
public final class JavaSyntaxCheck {
  public static void main(String[] args) throws Exception {
    JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
    if(compiler==null)throw new IllegalStateException("JDK required");
    List<File> files=new ArrayList<>();
    Path root=Paths.get(args[0]);
    for(String relative:new String[]{"app/src", "tests", "tools"}) {
      Path base=root.resolve(relative);
      if(!Files.isDirectory(base))continue;
      try(java.util.stream.Stream<Path> stream=Files.walk(base)) {
        stream.filter(p->p.toString().endsWith(".java")).forEach(p->files.add(p.toFile()));
      }
    }
    DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
    try(StandardJavaFileManager manager=compiler.getStandardFileManager(diagnostics,null,java.nio.charset.StandardCharsets.UTF_8)){
      JavacTask task=(JavacTask)compiler.getTask(null,manager,diagnostics,
          Arrays.asList("--release","8","-proc:none","-Xlint:-options"),null,
          manager.getJavaFileObjectsFromFiles(files));
      task.parse();
      long errors=diagnostics.getDiagnostics().stream().filter(d->d.getKind()==Diagnostic.Kind.ERROR).count();
      for(Diagnostic<?> d:diagnostics.getDiagnostics())if(d.getKind()==Diagnostic.Kind.ERROR)System.out.println(d);
      if(errors!=0)throw new AssertionError(errors+" syntax errors");
      System.out.println("PASS: parsed "+files.size()+" Java source files as Java 8. SYNTAX ONLY; Android symbols NOT type-checked.");
    }
  }
}
